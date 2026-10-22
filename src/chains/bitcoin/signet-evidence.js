import { createHash } from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function textValue(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function sha256Hex(value, label) {
  const text = textValue(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${label} must be 32-byte hexadecimal.`);
  return text;
}

function txid(value, label) {
  return sha256Hex(value, label);
}

function integer(value, label, { positive = false } = {}) {
  if (!['string', 'number', 'bigint'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new TypeError(`${label} must be a non-negative integer primitive.`);
  }
  const text = typeof value === 'string' ? value : value.toString();
  if (!/^\d+$/.test(text)) throw new TypeError(`${label} must be a non-negative integer.`);
  if (positive && BigInt(text) === 0n) throw new TypeError(`${label} must be greater than zero.`);
  return text;
}

function iso(value, label) {
  const text = textValue(value, label);
  const invalid = () => new TypeError(`${label} must be a valid ISO-8601 timestamp with a real calendar date and timezone.`);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
  if (!parts) throw invalid();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    fraction = '', , offsetSign, offsetHourText, offsetMinuteText] = parts;
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText
  ].map(Number);
  const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
  const offsetHours = Number(offsetHourText ?? 0);
  const offsetMinutes = Number(offsetMinuteText ?? 0);
  if (offsetHours > 23 || offsetMinutes > 59) throw invalid();

  // Date.parse accepts impossible dates by rolling them into the next month.
  // Round-trip each UTC calendar field before trusting the observation clock.
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, milliseconds);
  if (!Number.isFinite(calendar.getTime()) ||
      calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour ||
      calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) {
    throw invalid();
  }
  const offset = (offsetSign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60000;
  if (Date.parse(text) !== calendar.getTime() - offset) throw invalid();
  return text;
}

function normalizeObservationSource(value) {
  const source = textValue(value, 'observationSource');
  if (!['offline-fixture', 'imported-json', 'bitcoin-core-rpc'].includes(source)) {
    throw new TypeError('Unsupported Bitcoin Signet observationSource.');
  }
  return source;
}

export function createBitcoinSignetObservationEvidence({
  finalizerEvidence,
  finalTransactionEvidence,
  transaction,
  chainTip,
  rescueUtxo,
  minimumConfirmations = 6,
  observationSource = 'offline-fixture'
}) {
  if (!finalizerEvidence || finalizerEvidence.schema !== 'omegavault.bitcoin.finalizer-evidence.v1') {
    throw new TypeError('Bitcoin Signet evidence requires a finalizer evidence artifact.');
  }
  if (finalizerEvidence.networkRef !== 'bitcoin:signet') throw new TypeError('Bitcoin observation evidence is Signet-only.');
  if (finalizerEvidence.destinationCheckedByFinalizer !== true || finalizerEvidence.broadcastAuthorized !== false) {
    throw new Error('Bitcoin finalizer authority boundary is invalid.');
  }
  const { sha256:finalizerSha256, ...finalizerCore } = finalizerEvidence;
  if (sha256Hex(finalizerSha256, 'finalizerEvidence.sha256') !== digest(finalizerCore)) {
    throw new Error('Bitcoin finalizer evidence digest is invalid.');
  }
  if (!finalTransactionEvidence || finalTransactionEvidence.schema !== 'omegavault.bitcoin.final-transaction-evidence.v1') {
    throw new TypeError('Bitcoin Signet evidence requires deterministic final-transaction evidence.');
  }
  if (finalTransactionEvidence.networkRef !== 'bitcoin:signet' || finalTransactionEvidence.broadcastAuthorized !== false) {
    throw new Error('Bitcoin final-transaction authority boundary is invalid.');
  }
  const { sha256:finalTransactionSha256, ...finalTransactionCore } = finalTransactionEvidence;
  if (sha256Hex(finalTransactionSha256, 'finalTransactionEvidence.sha256') !== digest(finalTransactionCore)) {
    throw new Error('Bitcoin final-transaction evidence digest is invalid.');
  }
  if (finalTransactionEvidence.finalizerEvidenceSha256 !== finalizerEvidence.sha256) {
    throw new Error('Bitcoin final transaction is bound to another finalizer artifact.');
  }
  if (finalTransactionEvidence.rescueScriptPubKey !== finalizerEvidence.rescueScriptPubKey || finalTransactionEvidence.rescueAmountSats !== finalizerEvidence.rescueAmountSats) {
    throw new Error('Bitcoin final transaction rescue output does not match finalizer evidence.');
  }
  // Two individually digest-valid receipts may still describe different
  // recoveries. Bind the PSBT, descriptor and economics across both records.
  for (const field of ['psbtSha256', 'descriptorPolicyDigest', 'feeSats']) {
    if (finalTransactionEvidence[field] !== finalizerEvidence[field]) {
      throw new Error(`Bitcoin final transaction ${field} does not match finalizer evidence.`);
    }
  }
  if (!Number.isSafeInteger(minimumConfirmations) || minimumConfirmations < 1) {
    throw new TypeError('minimumConfirmations must be a positive safe integer.');
  }
  const normalizedObservationSource = normalizeObservationSource(observationSource);

  const transactionId = txid(transaction?.transactionId, 'transaction.transactionId');
  if (transactionId !== txid(finalTransactionEvidence.txid, 'finalTransactionEvidence.txid')) {
    throw new Error('Bitcoin Signet observation is bound to another final transaction.');
  }
  const confirmations = integer(transaction?.confirmations, 'transaction.confirmations');
  if (BigInt(confirmations) < BigInt(minimumConfirmations)) throw new Error('Bitcoin Signet transaction has not reached the required confirmation depth.');
  const blockHash = sha256Hex(transaction?.blockHash, 'transaction.blockHash');
  const blockHeight = integer(transaction?.blockHeight, 'transaction.blockHeight', { positive:true });
  const observedAt = iso(transaction?.observedAt, 'transaction.observedAt');
  if (transaction?.networkRef !== 'bitcoin:signet') throw new Error('Bitcoin transaction observation is not bound to Signet.');

  if (chainTip?.networkRef !== 'bitcoin:signet') throw new Error('Bitcoin chain-tip observation is not bound to Signet.');
  const tipHash = sha256Hex(chainTip?.blockHash, 'chainTip.blockHash');
  const tipHeight = integer(chainTip?.blockHeight, 'chainTip.blockHeight', { positive:true });
  const tipObservedAt = iso(chainTip?.observedAt, 'chainTip.observedAt');
  if (BigInt(tipHeight) < BigInt(blockHeight)) throw new Error('Bitcoin chain tip predates the observed transaction block.');
  if (tipHeight === blockHeight && tipHash !== blockHash) {
    throw new Error('Bitcoin chain tip hash does not match the transaction block at equal height.');
  }
  const derivedConfirmations = BigInt(tipHeight) - BigInt(blockHeight) + 1n;
  if (derivedConfirmations.toString() !== confirmations) throw new Error('Bitcoin confirmation count does not match the bound chain tip.');
  if (Date.parse(tipObservedAt) < Date.parse(observedAt)) throw new Error('Bitcoin chain-tip observation is stale relative to the transaction observation.');

  if (txid(rescueUtxo?.txid, 'rescueUtxo.txid') !== transactionId) {
    throw new Error('Bitcoin rescue UTXO is bound to another transaction.');
  }
  if (!Number.isSafeInteger(rescueUtxo?.vout) || rescueUtxo.vout < 0 || rescueUtxo.vout > 0xffffffff) {
    throw new TypeError('rescueUtxo.vout must be a non-negative uint32 integer.');
  }
  const rescueOutputIndexes = Array.isArray(finalizerEvidence.outputs)
    ? finalizerEvidence.outputs.flatMap((output, index) =>
      output?.scriptPubKey === finalizerEvidence.rescueScriptPubKey ? [index] : [])
    : [];
  if (rescueOutputIndexes.length !== 1) {
    throw new Error('Bitcoin finalizer evidence must identify exactly one rescue output.');
  }
  if (rescueUtxo.vout !== rescueOutputIndexes[0]) {
    throw new Error('Observed Bitcoin rescue UTXO index does not match the bound finalizer rescue output.');
  }
  const amountSats = integer(rescueUtxo?.amountSats, 'rescueUtxo.amountSats');
  const scriptPubKey = textValue(rescueUtxo?.scriptPubKey, 'rescueUtxo.scriptPubKey').toLowerCase();
  if (!/^[0-9a-f]+$/.test(scriptPubKey) || scriptPubKey.length % 2) throw new TypeError('rescueUtxo.scriptPubKey must be even-length hex.');
  if (scriptPubKey !== finalizerEvidence.rescueScriptPubKey) throw new Error('Observed Bitcoin rescue UTXO script does not match finalizer evidence.');
  if (amountSats !== finalizerEvidence.rescueAmountSats) throw new Error('Observed Bitcoin rescue UTXO amount does not match finalizer evidence.');
  if (rescueUtxo?.unspent !== true) throw new Error('Observed Bitcoin rescue output is not currently unspent.');

  const core = Object.freeze({
    schema:'omegavault.bitcoin.signet-observation-evidence.v2',
    chainId:'bitcoin',
    networkRef:'bitcoin:signet',
    observationSource:normalizedObservationSource,
    finalizerEvidenceSha256:sha256Hex(finalizerEvidence.sha256, 'finalizerEvidence.sha256'),
    finalTransactionEvidenceSha256:sha256Hex(finalTransactionEvidence.sha256, 'finalTransactionEvidence.sha256'),
    rawTransactionSha256:sha256Hex(finalTransactionEvidence.rawTransactionSha256, 'finalTransactionEvidence.rawTransactionSha256'),
    wtxid:sha256Hex(finalTransactionEvidence.wtxid, 'finalTransactionEvidence.wtxid'),
    psbtSha256:sha256Hex(finalizerEvidence.psbtSha256, 'finalizerEvidence.psbtSha256'),
    descriptorPolicyDigest:sha256Hex(finalizerEvidence.descriptorPolicyDigest, 'finalizerEvidence.descriptorPolicyDigest'),
    transaction:Object.freeze({
      transactionId,
      confirmations,
      minimumConfirmations:String(minimumConfirmations),
      blockHash,
      blockHeight,
      observedAt
    }),
    chainTip:Object.freeze({ blockHash:tipHash, blockHeight:tipHeight, observedAt:tipObservedAt }),
    rescueUtxo:Object.freeze({
      txid:transactionId,
      vout:rescueUtxo.vout,
      amountSats,
      scriptPubKey,
      unspent:true
    }),
    signetObservationComplete:true,
    publicSignetObservationProven:normalizedObservationSource === 'bitcoin-core-rpc',
    immutableRescueOnChain:false,
    chainPromotionAuthority:false,
    authorityBoundary:'This bundle records read-only Bitcoin Signet inclusion/confirmation and rescue-output observations with explicit fixture/imported/live-RPC provenance. Only bitcoin-core-rpc provenance may establish public Signet observation; no source authorizes broadcasts, wallets, mainnet activity, or promotion past the known immutable-rescue semantic limitation.'
  });
  return Object.freeze({ ...core, sha256:digest(core) });
}

export function verifyBitcoinSignetObservationEvidence({
  evidence,
  finalizerEvidence,
  finalTransactionEvidence,
  transaction,
  chainTip,
  rescueUtxo,
  minimumConfirmations = 6,
  observationSource = 'offline-fixture'
}) {
  let expected;
  try {
    expected = createBitcoinSignetObservationEvidence({
      finalizerEvidence,
      finalTransactionEvidence,
      transaction,
      chainTip,
      rescueUtxo,
      minimumConfirmations,
      observationSource
    });
  } catch (error) {
    return Object.freeze({ ok:false, errors:Object.freeze([String(error?.message || error)]) });
  }
  const ok = JSON.stringify(evidence) === JSON.stringify(expected);
  return Object.freeze({ ok, errors:Object.freeze(ok ? [] : ['Bitcoin Signet observation evidence does not match supplied observations.']) });
}

function requireMethod(driver, name) {
  if (typeof driver?.[name] !== 'function') throw new TypeError(`Bitcoin Signet observation driver requires ${name}().`);
}

export async function runBitcoinSignetObservationProof({
  driver,
  finalizerEvidence,
  finalTransactionEvidence,
  minimumConfirmations = 6,
  observationSource = 'offline-fixture'
}) {
  for (const method of ['readTransaction','readChainTip','readTxOut']) requireMethod(driver, method);
  const normalizedObservationSource = normalizeObservationSource(observationSource);
  if (normalizedObservationSource === 'bitcoin-core-rpc') {
    if (driver?.provenance !== 'bitcoin-core-rpc') {
      throw new Error('Live Bitcoin Signet observation requires a driver with bitcoin-core-rpc provenance.');
    }
    requireMethod(driver, 'readBlockHashAtHeight');
  }
  const requestedTxid = txid(finalTransactionEvidence?.txid, 'finalTransactionEvidence.txid');
  const transaction = await driver.readTransaction({ transactionId:requestedTxid, networkRef:'bitcoin:signet' });
  if (txid(transaction?.transactionId, 'transaction.transactionId') !== requestedTxid) {
    throw new Error('Bitcoin Signet driver returned a different transaction.');
  }
  const chainTip = await driver.readChainTip({ networkRef:'bitcoin:signet' });
  // getrawtransaction's block hash may belong to a stale fork. A separate
  // height-to-hash lookup binds live observations to the active Signet chain.
  if (normalizedObservationSource === 'bitcoin-core-rpc') {
    const activeBlockHash = await driver.readBlockHashAtHeight({
      blockHeight:transaction.blockHeight, networkRef:'bitcoin:signet'
    });
    if (txid(activeBlockHash, 'activeBlockHash') !== txid(transaction.blockHash, 'transaction.blockHash')) {
      throw new Error('Bitcoin Signet transaction block is not on the active chain at its claimed height.');
    }
  }
  const candidateOutputs = Array.isArray(finalizerEvidence?.outputs) ? finalizerEvidence.outputs : [];
  const rescueIndexes = candidateOutputs
    .map((output, index) => ({ output, index }))
    .filter(({ output }) => output?.scriptPubKey === finalizerEvidence.rescueScriptPubKey);
  if (rescueIndexes.length !== 1) throw new Error('Finalizer evidence does not identify exactly one rescue output.');
  const { index } = rescueIndexes[0];
  const rescueUtxo = await driver.readTxOut({ transactionId:requestedTxid, vout:index, networkRef:'bitcoin:signet' });
  if (normalizedObservationSource === 'bitcoin-core-rpc') {
    // gettxout proves a UTXO only relative to its reported best block.
    // Reject races/reorgs instead of mixing observations from different tips.
    if (txid(rescueUtxo?.bestBlockHash, 'rescueUtxo.bestBlockHash') !==
        txid(chainTip.blockHash, 'chainTip.blockHash')) {
      throw new Error('Bitcoin Signet UTXO best block differs from the observed chain tip.');
    }
    const expectedDepth = BigInt(integer(chainTip.blockHeight, 'chainTip.blockHeight')) -
      BigInt(integer(transaction.blockHeight, 'transaction.blockHeight')) + 1n;
    if (integer(rescueUtxo?.confirmations, 'rescueUtxo.confirmations') !==
        expectedDepth.toString()) {
      throw new Error('Bitcoin Signet UTXO confirmation depth differs from the observed chain.');
    }
    const postReadTip = await driver.readChainTip({ networkRef:'bitcoin:signet' });
    if (txid(postReadTip?.blockHash, 'postReadTip.blockHash') !==
        txid(chainTip.blockHash, 'chainTip.blockHash') ||
        integer(postReadTip?.blockHeight, 'postReadTip.blockHeight') !==
        integer(chainTip.blockHeight, 'chainTip.blockHeight')) {
      throw new Error('Bitcoin Signet tip changed during read-only proof collection.');
    }
    if (Date.parse(iso(postReadTip?.observedAt, 'postReadTip.observedAt')) <
        Date.parse(iso(chainTip?.observedAt, 'chainTip.observedAt'))) {
      throw new Error('Bitcoin Signet post-read chain-tip timestamp regressed.');
    }
  }
  const evidence = createBitcoinSignetObservationEvidence({
    finalizerEvidence,
    finalTransactionEvidence,
    transaction,
    chainTip,
    rescueUtxo,
    minimumConfirmations,
    observationSource:normalizedObservationSource
  });
  return Object.freeze({
    kind:'bitcoin-signet-observation-proof',
    success:true,
    evidence,
    authorityBoundary:'This runner is read-only. It observes a caller-supplied Signet transaction ID and cannot construct, sign, finalize, or broadcast Bitcoin transactions.'
  });
}

/**
 * Independently re-derive an already saved observation receipt. This checks
 * internal identities, economics, hash integrity and authority boundaries;
 * caller-supplied provenance is NOT independently authenticated without a
 * fresh read-only Bitcoin Core observation.
 */
export function verifyBitcoinSignetObservationArtifact({
  evidence, finalizerEvidence, finalTransactionEvidence
}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return Object.freeze({ ok:false, errors:Object.freeze(['Bitcoin Signet observation artifact is required.']) });
  }
  const minimum = Number(evidence.transaction?.minimumConfirmations);
  return verifyBitcoinSignetObservationEvidence({
    evidence, finalizerEvidence, finalTransactionEvidence,
    transaction:evidence.transaction ? { ...evidence.transaction, networkRef:'bitcoin:signet' } : null,
    chainTip:evidence.chainTip ? { ...evidence.chainTip, networkRef:'bitcoin:signet' } : null,
    rescueUtxo:evidence.rescueUtxo,
    minimumConfirmations:minimum,
    observationSource:evidence.observationSource
  });
}
