import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

const SATOSHIS = 100_000_000n;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function hash256(value) {
  return sha256(sha256(value));
}

function transactionId(bytes) {
  return Buffer.from(hash256(bytes)).reverse().toString('hex');
}

function exactInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`);
  return value;
}

function positiveInteger(value, label) {
  const normalized = exactInteger(value, label);
  if (normalized < 1) throw new TypeError(`${label} must be a positive safe integer.`);
  return normalized;
}

function sha256Hex(value, label) {
  const text = String(value ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${label} must be 32-byte hexadecimal.`);
  return text;
}

function iso(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  const invalid = () => new TypeError(`${label} must be a valid ISO-8601 timestamp with a real calendar date and timezone.`);
  // Mirror the strict real-date and explicit-timezone contract used by
  // Bitcoin Signet inclusion observations; Date.parse alone rolls invalid dates.
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

function btcToSats(value, label) {
  let text;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a non-negative BTC amount.`);
    text = value.toFixed(8);
    if (Number(text) !== value) throw new TypeError(`${label} must not contain fractional satoshis.`);
  } else {
    text = String(value);
  }
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) throw new TypeError(`${label} must be a non-negative BTC decimal with at most 8 places.`);
  const [whole, fraction = ''] = text.split('.');
  return (BigInt(whole) * SATOSHIS + BigInt(fraction.padEnd(8, '0'))).toString();
}

function normalizeObservationContext(context) {
  if (context == null) return null;
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('observationContext must be an object.');
  const fields = Object.keys(context).sort();
  if (JSON.stringify(fields) !== JSON.stringify(['observedAt', 'previousEvidenceSha256', 'sequence'])) {
    throw new TypeError('observationContext must contain exactly observedAt, previousEvidenceSha256 and sequence.');
  }
  if (context.previousEvidenceSha256 === undefined) {
    throw new TypeError('observationContext.previousEvidenceSha256 must be null or a SHA-256 digest.');
  }
  const sequence = positiveInteger(context.sequence, 'observationContext.sequence');
  const observedAt = iso(context.observedAt, 'observationContext.observedAt');
  const previousEvidenceSha256 = context.previousEvidenceSha256 == null
    ? null
    : sha256Hex(context.previousEvidenceSha256, 'observationContext.previousEvidenceSha256');
  return Object.freeze({ sequence, observedAt, previousEvidenceSha256 });
}

function requireTransaction(transaction) {
  if (!transaction || transaction.kind !== 'bitcoin-signet-final-transaction') throw new TypeError('A deterministic Bitcoin final transaction is required.');
  if (transaction.networkRef !== 'bitcoin:signet' || transaction.broadcastAuthorized !== false) throw new Error('Bitcoin Core cross-check transaction authority boundary is invalid.');
  const raw = Buffer.from(transaction.rawHex ?? '', 'hex');
  if (!raw.length || raw.toString('hex') !== transaction.rawHex) throw new TypeError('Final transaction rawHex must be canonical non-empty hex.');
  const stripped = Buffer.from(transaction.strippedHex ?? '', 'hex');
  if (!stripped.length || stripped.toString('hex') !== transaction.strippedHex) throw new TypeError('Final transaction strippedHex must be canonical non-empty hex.');
  if (transactionId(raw) !== transaction.wtxid) throw new Error('Final transaction wtxid does not match rawHex.');
  if (transactionId(stripped) !== transaction.txid) throw new Error('Final transaction txid does not match strippedHex.');
  if (exactInteger(transaction.bytes, 'transaction.bytes') !== raw.length) throw new Error('Final transaction byte size does not match rawHex.');
  if (exactInteger(transaction.strippedBytes, 'transaction.strippedBytes') !== stripped.length) throw new Error('Final transaction stripped byte size does not match strippedHex.');
  const weight = stripped.length * 3 + raw.length;
  if (exactInteger(transaction.weight, 'transaction.weight') !== weight) throw new Error('Final transaction weight does not match serialized bytes.');
  if (exactInteger(transaction.virtualBytes, 'transaction.virtualBytes') !== Math.ceil(weight / 4)) throw new Error('Final transaction virtual size does not match serialized bytes.');
  if (!transaction.finalizerEvidence || transaction.finalizerEvidence.schema !== 'omegavault.bitcoin.finalizer-evidence.v1') {
    throw new TypeError('Final transaction must retain bound finalizer evidence.');
  }
  const { sha256:finalizerSha256, ...finalizerCore } = transaction.finalizerEvidence;
  if (sha256Hex(finalizerSha256, 'transaction.finalizerEvidence.sha256') !== digest(finalizerCore)) {
    throw new Error('Final transaction finalizer evidence digest is invalid.');
  }
  return raw;
}

function normalizeNode(node, expectedNodeVersion) {
  if (node?.chain !== 'signet') throw new Error('Bitcoin Core cross-check requires Signet chain identity.');
  if (!Number.isSafeInteger(expectedNodeVersion) || expectedNodeVersion < 1) throw new TypeError('expectedNodeVersion must be a positive safe integer.');
  if (node?.version !== expectedNodeVersion) throw new Error(`Bitcoin Core version must equal pinned value ${expectedNodeVersion}.`);
  if (typeof node?.subversion !== 'string' || !node.subversion.trim() || /[\u0000-\u001f\u007f]/.test(node.subversion)) throw new TypeError('Bitcoin Core subversion must be non-empty text without control characters.');
  if (!Number.isSafeInteger(node?.protocolVersion) || node.protocolVersion < 1) throw new TypeError('Bitcoin Core protocolVersion is required.');
  return Object.freeze({ chain:'signet', version:node.version, subversion:node.subversion, protocolVersion:node.protocolVersion });
}

function validateDecoded(transaction, decoded) {
  if (decoded?.txid !== transaction.txid) throw new Error('Bitcoin Core decoded txid does not match deterministic extraction.');
  if (decoded?.hash !== transaction.wtxid) throw new Error('Bitcoin Core decoded wtxid does not match deterministic extraction.');
  for (const [field, expected] of [['size', transaction.bytes], ['vsize', transaction.virtualBytes], ['weight', transaction.weight], ['version', transaction.finalizerEvidence.txVersion], ['locktime', transaction.locktime]]) {
    if (exactInteger(decoded?.[field], `decoded.${field}`) !== expected) throw new Error(`Bitcoin Core decoded ${field} does not match deterministic extraction.`);
  }
  const expectedInputs = transaction.finalizerEvidence.inputs;
  if (!Array.isArray(decoded?.vin) || decoded.vin.length !== expectedInputs.length) throw new Error('Bitcoin Core decoded input count does not match extraction.');
  decoded.vin.forEach((input, index) => {
    const expected = expectedInputs[index];
    if (input?.txid !== expected.txid || input?.vout !== expected.vout || input?.sequence !== expected.sequence) {
      throw new Error(`Bitcoin Core decoded input ${index} does not match extraction.`);
    }
    if (input?.scriptSig?.hex !== '') throw new Error(`Bitcoin Core decoded input ${index} must have an empty native scriptSig.`);
    if (JSON.stringify(input?.txinwitness) !== JSON.stringify(transaction.witnesses[index].stackItems)) {
      throw new Error(`Bitcoin Core decoded witness ${index} does not match extraction.`);
    }
  });
  const expectedOutputs = transaction.finalizerEvidence.outputs;
  if (!Array.isArray(decoded?.vout) || decoded.vout.length !== expectedOutputs.length) throw new Error('Bitcoin Core decoded output count does not match extraction.');
  decoded.vout.forEach((output, index) => {
    const expected = expectedOutputs[index];
    if (output?.n !== index) throw new Error(`Bitcoin Core decoded output ${index} index is not canonical.`);
    if (btcToSats(output?.value, `decoded.vout[${index}].value`) !== expected.amountSats) throw new Error(`Bitcoin Core decoded output ${index} amount does not match extraction.`);
    if (output?.scriptPubKey?.hex !== expected.scriptPubKey) throw new Error(`Bitcoin Core decoded output ${index} script does not match extraction.`);
  });
}

function normalizeMempool(transaction, result) {
  if (result?.txid !== transaction.txid || result?.wtxid !== transaction.wtxid) throw new Error('Bitcoin Core mempool result is bound to another transaction.');
  if (typeof result?.allowed !== 'boolean') throw new TypeError('Bitcoin Core mempool result requires allowed boolean.');
  if (result['package-error'] !== undefined) throw new Error('Single-transaction Bitcoin Core mempool result must not contain package-error.');

  if (!result.allowed) {
    const rejectReason = String(result['reject-reason'] ?? '').trim();
    if (!rejectReason) throw new Error('Rejected Bitcoin Core mempool result requires reject-reason.');
    if (result.vsize !== undefined || result.fees !== undefined) {
      throw new Error('Rejected Bitcoin Core mempool result must not carry successful fee/vsize diagnostics.');
    }
    return Object.freeze({
      txid:result.txid,
      wtxid:result.wtxid,
      allowed:false,
      vsize:null,
      feeSats:null,
      baseFeeBtc:null,
      effectiveFeeRateSatsPerKvB:null,
      effectiveIncludes:Object.freeze([]),
      feeDiagnosticsBound:false,
      rejectReason
    });
  }

  if (String(result['reject-reason'] ?? '').trim()) throw new Error('Allowed Bitcoin Core mempool result must not contain reject-reason.');
  const vsize = exactInteger(result.vsize, 'mempool.vsize');
  if (vsize !== transaction.virtualBytes) throw new Error('Bitcoin Core mempool vsize does not match deterministic extraction.');
  if (!result.fees || typeof result.fees !== 'object' || Array.isArray(result.fees)) throw new TypeError('Allowed Bitcoin Core mempool result requires fee diagnostics.');
  const feeSats = btcToSats(result.fees.base, 'mempool.fees.base');
  if (feeSats !== transaction.finalizerEvidence.feeSats) throw new Error('Bitcoin Core mempool base fee does not match deterministic extracted transaction fee.');
  const effectiveFeeRateSatsPerKvB = btcToSats(result.fees['effective-feerate'], 'mempool.fees.effective-feerate');
  if (!Array.isArray(result.fees['effective-includes'])) throw new TypeError('Bitcoin Core mempool fee diagnostics require effective-includes.');
  const effectiveIncludes = result.fees['effective-includes'].map((value, index) => sha256Hex(value, `mempool.fees.effective-includes[${index}]`));
  if (effectiveIncludes.length !== 1 || effectiveIncludes[0] !== transaction.wtxid) {
    throw new Error('Bitcoin Core mempool effective fee diagnostics are not bound exclusively to the extracted transaction.');
  }
  return Object.freeze({
    txid:result.txid,
    wtxid:result.wtxid,
    allowed:true,
    vsize,
    feeSats,
    baseFeeBtc:String(result.fees.base),
    effectiveFeeRateSatsPerKvB,
    effectiveIncludes:Object.freeze(effectiveIncludes),
    feeDiagnosticsBound:true,
    rejectReason:null
  });
}

export function createBitcoinCoreCrossCheckEvidence({
  transaction,
  node,
  decodedTransaction,
  mempoolResult,
  expectedNodeVersion = 310100,
  observationSource = 'offline-fixture',
  observationContext = null
}) {
  const raw = requireTransaction(transaction);
  const normalizedNode = normalizeNode(node, expectedNodeVersion);
  validateDecoded(transaction, decodedTransaction);
  const mempool = normalizeMempool(transaction, mempoolResult);
  if (!['offline-fixture', 'imported-json', 'bitcoin-core-rpc'].includes(observationSource)) throw new TypeError('Unsupported Bitcoin Core observationSource.');
  const normalizedObservationContext = normalizeObservationContext(observationContext);
  const core = Object.freeze({
    schema:'omegavault.bitcoin.core-cross-check-evidence.v2',
    chainId:'bitcoin',
    networkRef:'bitcoin:signet',
    observationSource,
    observationContext:normalizedObservationContext,
    node:normalizedNode,
    rawTransactionSha256:createHash('sha256').update(raw).digest('hex'),
    finalTransactionEvidenceSha256:transaction.finalizerEvidence.sha256,
    txid:transaction.txid,
    wtxid:transaction.wtxid,
    bytes:transaction.bytes,
    weight:transaction.weight,
    virtualBytes:transaction.virtualBytes,
    extractedFeeSats:transaction.finalizerEvidence.feeSats,
    decodedTransactionMatches:true,
    mempool,
    feeDiagnosticsBound:mempool.feeDiagnosticsBound,
    bitcoinCoreCrossCheckProven:observationSource === 'bitcoin-core-rpc' && mempool.allowed && mempool.feeDiagnosticsBound,
    signetExecutionProven:false,
    broadcastPerformed:false,
    broadcastAuthorized:false,
    chainPromotionAuthority:false,
    authorityBoundary:'This evidence binds read-only Bitcoin Core decoding and testmempoolaccept fee/vsize diagnostics to one deterministic Signet transaction. It never broadcasts, handles keys, proves inclusion/finality, or establishes immutable-rescue semantics.'
  });
  return Object.freeze({ ...core, sha256:digest(core) });
}

export function verifyBitcoinCoreCrossCheckEvidence({ evidence, ...inputs }) {
  try {
    const expected = createBitcoinCoreCrossCheckEvidence(inputs);
    const ok = isDeepStrictEqual(evidence, expected);
    return Object.freeze({ ok, errors:Object.freeze(ok ? [] : ['Bitcoin Core cross-check evidence does not match supplied observations.']) });
  } catch (error) {
    return Object.freeze({ ok:false, errors:Object.freeze([String(error?.message || error)]) });
  }
}

// A checksum alone cannot authenticate authority flags. Re-derive them from
// the receipt's restricted source class and normalized mempool diagnostics.
function validateChainedCoreAuthority(evidence, index, errors) {
  const prefix = `Evidence ${index}`;
  if (evidence.chainId !== 'bitcoin' || evidence.networkRef !== 'bitcoin:signet' ||
      evidence.node?.chain !== 'signet') {
    errors.push(`${prefix} has invalid Signet network identity.`);
  }
  if (typeof evidence.node?.subversion !== 'string' || !evidence.node.subversion.trim() || /[\u0000-\u001f\u007f]/.test(evidence.node.subversion)) {
    errors.push(`${prefix} has invalid Bitcoin Core node subversion.`);
  }
  if (!Number.isSafeInteger(evidence.node?.version) || evidence.node.version < 1 ||
      !Number.isSafeInteger(evidence.node?.protocolVersion) || evidence.node.protocolVersion < 1) {
    errors.push(`${prefix} has invalid Bitcoin Core node version or protocol version.`);
  }
  for (const field of ['rawTransactionSha256', 'finalTransactionEvidenceSha256', 'txid', 'wtxid']) {
    if (typeof evidence[field] !== 'string' || !/^[0-9a-f]{64}$/.test(evidence[field])) {
      errors.push(`${prefix} has invalid ${field} hash identity.`);
    }
  }
  if (!Number.isSafeInteger(evidence.bytes) || evidence.bytes < 1 ||
      !Number.isSafeInteger(evidence.weight) || evidence.weight < evidence.bytes ||
      evidence.weight > evidence.bytes * 4 ||
      !Number.isSafeInteger(evidence.virtualBytes) ||
      evidence.virtualBytes !== Math.ceil(evidence.weight / 4)) {
    errors.push(`${prefix} has inconsistent transaction byte, weight or virtual size metadata.`);
  }
  if (typeof evidence.extractedFeeSats !== 'string' ||
      !/^(0|[1-9][0-9]{0,15})$/.test(evidence.extractedFeeSats) ||
      BigInt(evidence.extractedFeeSats) > 2100000000000000n) {
    errors.push(`${prefix} has invalid extracted fee satoshis.`);
  }
  const source = evidence.observationSource;
  if (!['offline-fixture', 'imported-json', 'bitcoin-core-rpc'].includes(source)) {
    errors.push(`${prefix} has unsupported observation provenance.`);
  }
  for (const key of ['signetExecutionProven', 'broadcastPerformed', 'broadcastAuthorized', 'chainPromotionAuthority']) {
    if (evidence[key] !== false) errors.push(`${prefix} has unauthorized ${key} authority flag.`);
  }
  if (evidence.decodedTransactionMatches !== true) {
    errors.push(`${prefix} does not assert a verified decoded transaction match.`);
  }
  const allowed = evidence.mempool?.allowed;
  const bound = evidence.mempool?.feeDiagnosticsBound;
  if (typeof allowed !== 'boolean' || typeof bound !== 'boolean' ||
      evidence.feeDiagnosticsBound !== bound || (bound && !allowed)) {
    errors.push(`${prefix} has inconsistent mempool fee diagnostics.`);
  }
  // Receipt chains must recheck internal transaction/fee consistency: a
  // rewritten SHA-256 cannot legitimize a cross-wired Core observation.
  if (evidence.mempool?.txid !== evidence.txid ||
      evidence.mempool?.wtxid !== evidence.wtxid) {
    errors.push(`${prefix} mempool transaction identity is inconsistent.`);
  }
  if (bound === true && (
    evidence.mempool?.feeSats !== evidence.extractedFeeSats ||
    evidence.mempool?.vsize !== evidence.virtualBytes ||
    !Array.isArray(evidence.mempool?.effectiveIncludes) ||
    evidence.mempool.effectiveIncludes.length !== 1 ||
    evidence.mempool.effectiveIncludes[0] !== evidence.wtxid
  )) {
    errors.push(`${prefix} mempool fee, size or effective-includes do not bind the transaction.`);
  }
  if (allowed === false && (
    typeof evidence.mempool?.rejectReason !== 'string' || !evidence.mempool.rejectReason.trim() ||
    evidence.mempool?.baseFeeBtc !== null || evidence.mempool?.effectiveFeeRateSatsPerKvB !== null ||
    !Array.isArray(evidence.mempool?.effectiveIncludes) ||
    bound !== false || evidence.mempool?.feeSats !== null ||
    evidence.mempool?.vsize !== null ||
    evidence.mempool?.effectiveIncludes?.length !== 0
  )) {
    errors.push(`${prefix} rejected mempool result carries successful diagnostics.`);
  }
  if (allowed === true) {
    try {
      if (bound !== true || evidence.mempool.rejectReason !== null ||
          typeof evidence.mempool.baseFeeBtc !== 'string' ||
          btcToSats(evidence.mempool.baseFeeBtc, 'mempool.baseFeeBtc') !== evidence.extractedFeeSats ||
          typeof evidence.mempool.effectiveFeeRateSatsPerKvB !== 'string' ||
          !/^(0|[1-9][0-9]*)$/.test(evidence.mempool.effectiveFeeRateSatsPerKvB)) {
        errors.push(`${prefix} has contradictory accepted mempool fee diagnostics.`);
      }
    } catch { errors.push(`${prefix} has invalid accepted mempool decimal fee.`); }
  }
  const proven = source === 'bitcoin-core-rpc' && allowed === true && bound === true;
  if (evidence.bitcoinCoreCrossCheckProven !== proven) {
    errors.push(`${prefix} has forged Bitcoin Core cross-check provenance.`);
  }
}

export function verifyBitcoinCoreCrossCheckEvidenceChain(evidences, { now = null, maxAgeMs = null } = {}) {
  const errors = [];
  if (!Array.isArray(evidences) || !evidences.length) return Object.freeze({ ok:false, errors:Object.freeze(['Bitcoin Core evidence chain must be a non-empty array.']) });
  const seen = new Set();
  let previous = null;
  let identity = null;
  let provenance = null;
  Array.from(evidences).forEach((evidence, index) => {
    if (!evidence || evidence.schema !== 'omegavault.bitcoin.core-cross-check-evidence.v2') {
      errors.push(`Evidence ${index} has an unsupported schema.`);
      return;
    }
    const { sha256:evidenceSha256, ...core } = evidence;
    let normalizedSha;
    try { normalizedSha = sha256Hex(evidenceSha256, `evidence[${index}].sha256`); }
    catch (error) { errors.push(String(error.message || error)); return; }
    if (normalizedSha !== digest(core)) errors.push(`Evidence ${index} digest is invalid.`);
    validateChainedCoreAuthority(evidence,index,errors);
    if (seen.has(normalizedSha)) errors.push(`Evidence ${index} replays a previously observed receipt.`);
    seen.add(normalizedSha);

    const currentIdentity = [
      evidence.rawTransactionSha256,
      evidence.finalTransactionEvidenceSha256,
      evidence.txid,
      evidence.wtxid
    ].join(':');
    if (identity == null) identity = currentIdentity;
    else if (currentIdentity !== identity) errors.push(`Evidence ${index} is bound to a different extracted transaction.`);

    if (provenance == null) provenance = evidence.observationSource;
    else if (evidence.observationSource !== provenance) errors.push(`Evidence ${index} mixes observation provenance with the receipt chain.`);

    const rawContext = evidence.observationContext;
    if (!rawContext) {
      errors.push(`Evidence ${index} lacks observationContext.`);
      return;
    }
    let context;
    try {
      const actualFields = Object.keys(rawContext).sort();
      const expectedFields = ['observedAt','previousEvidenceSha256','sequence'];
      if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) throw new Error('observationContext has unexpected or missing fields.');
      context = normalizeObservationContext(rawContext);
    } catch (error) {
      errors.push(`Evidence ${index} observationContext is invalid: ${String(error.message || error)}`);
      return;
    }

    if (previous) {
      const previousContext = previous.observationContext;
      if (context.sequence !== previousContext.sequence + 1) errors.push(`Evidence ${index} observation sequence is reordered or non-contiguous.`);
      if (context.previousEvidenceSha256 !== previous.sha256) errors.push(`Evidence ${index} previousEvidenceSha256 does not bind the preceding receipt.`);
      if (Date.parse(context.observedAt) <= Date.parse(previousContext.observedAt)) errors.push(`Evidence ${index} observation timestamp is stale or reordered.`);
    } else {
      if (context.sequence !== 1) errors.push('First Bitcoin Core evidence receipt must begin at sequence 1.');
      if (context.previousEvidenceSha256 !== null) {
        errors.push('First Bitcoin Core evidence receipt must not claim a predecessor.');
      }
    }
    previous = { ...evidence, observationContext:context };
  });
  if (now != null || maxAgeMs != null) {
    if (now == null || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) errors.push('now and non-negative maxAgeMs must be supplied together for freshness enforcement.');
    else if (previous?.observationContext) {
      let nowMs;
      try { nowMs = Date.parse(iso(now, 'now')); }
      catch (error) { errors.push(String(error.message || error)); }

      const observedMs = Date.parse(previous.observationContext.observedAt);
      if (observedMs > nowMs) errors.push('Latest Bitcoin Core observation is from the future.');
      else if (nowMs - observedMs > maxAgeMs) errors.push('Latest Bitcoin Core observation is stale.');
    }
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

function requireMethod(driver, name) {
  if (typeof driver?.[name] !== 'function') throw new TypeError(`Bitcoin Core cross-check driver requires ${name}().`);
}

export async function runBitcoinCoreCrossCheck({
  driver,
  transaction,
  expectedNodeVersion = 310100,
  observationSequence = 1,
  previousEvidenceSha256 = null,
  now = () => new Date().toISOString()
}) {
  requireTransaction(transaction);
  positiveInteger(observationSequence, 'observationSequence');
  if (previousEvidenceSha256 !== null) sha256Hex(previousEvidenceSha256, 'previousEvidenceSha256');
  if (typeof now !== 'function') throw new TypeError('now must be a clock function.');
  for (const method of ['getNetworkInfo', 'getBlockchainInfo', 'decodeRawTransaction', 'testMempoolAccept']) requireMethod(driver, method);
  const [network, blockchain] = await Promise.all([driver.getNetworkInfo(), driver.getBlockchainInfo()]);
  const node = { version:network?.version, subversion:network?.subversion, protocolVersion:network?.protocolversion, chain:blockchain?.chain };
  normalizeNode(node, expectedNodeVersion);
  const decodedTransaction = await driver.decodeRawTransaction({ rawHex:transaction.rawHex, networkRef:'bitcoin:signet' });
  const results = await driver.testMempoolAccept({ rawTransactions:[transaction.rawHex], maxFeeRate:0, networkRef:'bitcoin:signet' });
  if (!Array.isArray(results) || results.length !== 1) throw new Error('Bitcoin Core testmempoolaccept must return exactly one result.');
  const observationContext = {
    sequence:observationSequence,
    observedAt:now(),
    previousEvidenceSha256
  };
  return createBitcoinCoreCrossCheckEvidence({ transaction, node, decodedTransaction, mempoolResult:results[0], expectedNodeVersion, observationSource:'bitcoin-core-rpc', observationContext });
}
