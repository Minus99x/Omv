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
  const text = typeof value === 'bigint' ? value.toString() : String(value ?? '');
  if (!/^\d+$/.test(text)) throw new TypeError(`${label} must be a non-negative integer.`);
  if (positive && BigInt(text) === 0n) throw new TypeError(`${label} must be greater than zero.`);
  return text;
}

function iso(value, label) {
  const text = textValue(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${label} must be an ISO-compatible timestamp.`);
  return text;
}

export function createBitcoinSignetObservationEvidence({
  finalizerEvidence,
  transaction,
  rescueUtxo,
  minimumConfirmations = 6
}) {
  if (!finalizerEvidence || finalizerEvidence.schema !== 'omegavault.bitcoin.finalizer-evidence.v1') {
    throw new TypeError('Bitcoin Signet evidence requires a finalizer evidence artifact.');
  }
  if (finalizerEvidence.networkRef !== 'bitcoin:signet') throw new TypeError('Bitcoin observation evidence is Signet-only.');
  if (finalizerEvidence.destinationCheckedByFinalizer !== true || finalizerEvidence.broadcastAuthorized !== false) {
    throw new Error('Bitcoin finalizer authority boundary is invalid.');
  }
  if (!Number.isInteger(minimumConfirmations) || minimumConfirmations < 1) throw new TypeError('minimumConfirmations must be positive.');

  const transactionId = txid(transaction?.transactionId, 'transaction.transactionId');
  const confirmations = integer(transaction?.confirmations, 'transaction.confirmations');
  if (BigInt(confirmations) < BigInt(minimumConfirmations)) throw new Error('Bitcoin Signet transaction has not reached the required confirmation depth.');
  const blockHash = sha256Hex(transaction?.blockHash, 'transaction.blockHash');
  const blockHeight = integer(transaction?.blockHeight, 'transaction.blockHeight', { positive:true });
  const observedAt = iso(transaction?.observedAt, 'transaction.observedAt');
  if (transaction?.networkRef !== 'bitcoin:signet') throw new Error('Bitcoin transaction observation is not bound to Signet.');

  if (txid(rescueUtxo?.txid, 'rescueUtxo.txid') !== transactionId) {
    throw new Error('Bitcoin rescue UTXO is bound to another transaction.');
  }
  if (!Number.isInteger(rescueUtxo?.vout) || rescueUtxo.vout < 0) throw new TypeError('rescueUtxo.vout must be a non-negative integer.');
  const amountSats = integer(rescueUtxo?.amountSats, 'rescueUtxo.amountSats');
  const scriptPubKey = textValue(rescueUtxo?.scriptPubKey, 'rescueUtxo.scriptPubKey').toLowerCase();
  if (!/^[0-9a-f]+$/.test(scriptPubKey) || scriptPubKey.length % 2) throw new TypeError('rescueUtxo.scriptPubKey must be even-length hex.');
  if (scriptPubKey !== finalizerEvidence.rescueScriptPubKey) throw new Error('Observed Bitcoin rescue UTXO script does not match finalizer evidence.');
  if (amountSats !== finalizerEvidence.rescueAmountSats) throw new Error('Observed Bitcoin rescue UTXO amount does not match finalizer evidence.');
  if (rescueUtxo?.unspent !== true) throw new Error('Observed Bitcoin rescue output is not currently unspent.');

  const core = Object.freeze({
    schema:'omegavault.bitcoin.signet-observation-evidence.v1',
    chainId:'bitcoin',
    networkRef:'bitcoin:signet',
    finalizerEvidenceSha256:sha256Hex(finalizerEvidence.sha256, 'finalizerEvidence.sha256'),
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
    rescueUtxo:Object.freeze({
      txid:transactionId,
      vout:rescueUtxo.vout,
      amountSats,
      scriptPubKey,
      unspent:true
    }),
    signetObservationComplete:true,
    immutableRescueOnChain:false,
    chainPromotionAuthority:false,
    authorityBoundary:'This bundle records read-only Bitcoin Signet inclusion/confirmation and rescue-output observations bound to an offline finalizer artifact. It does not authorize broadcasts, wallets, mainnet activity, or promotion past the known immutable-rescue semantic limitation.'
  });
  return Object.freeze({ ...core, sha256:digest(core) });
}

export function verifyBitcoinSignetObservationEvidence({
  evidence,
  finalizerEvidence,
  transaction,
  rescueUtxo,
  minimumConfirmations = 6
}) {
  let expected;
  try {
    expected = createBitcoinSignetObservationEvidence({
      finalizerEvidence,
      transaction,
      rescueUtxo,
      minimumConfirmations
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
  transactionId,
  minimumConfirmations = 6
}) {
  for (const method of ['readTransaction','readTxOut']) requireMethod(driver, method);
  const requestedTxid = txid(transactionId, 'transactionId');
  const transaction = await driver.readTransaction({ transactionId:requestedTxid, networkRef:'bitcoin:signet' });
  if (txid(transaction?.transactionId, 'transaction.transactionId') !== requestedTxid) {
    throw new Error('Bitcoin Signet driver returned a different transaction.');
  }
  const candidateOutputs = Array.isArray(finalizerEvidence?.outputs) ? finalizerEvidence.outputs : [];
  const rescueIndexes = candidateOutputs
    .map((output, index) => ({ output, index }))
    .filter(({ output }) => output?.scriptPubKey === finalizerEvidence.rescueScriptPubKey);
  if (rescueIndexes.length !== 1) throw new Error('Finalizer evidence does not identify exactly one rescue output.');
  const { index } = rescueIndexes[0];
  const rescueUtxo = await driver.readTxOut({ transactionId:requestedTxid, vout:index, networkRef:'bitcoin:signet' });
  const evidence = createBitcoinSignetObservationEvidence({
    finalizerEvidence,
    transaction,
    rescueUtxo,
    minimumConfirmations
  });
  return Object.freeze({
    kind:'bitcoin-signet-observation-proof',
    success:true,
    evidence,
    authorityBoundary:'This runner is read-only. It observes a caller-supplied Signet transaction ID and cannot construct, sign, finalize, or broadcast Bitcoin transactions.'
  });
}
