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

function exactInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`);
  return value;
}

function btcToSats(value, label) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) throw new TypeError(`${label} must be a non-negative BTC decimal with at most 8 places.`);
  const [whole, fraction = ''] = text.split('.');
  return (BigInt(whole) * SATOSHIS + BigInt(fraction.padEnd(8, '0'))).toString();
}

function requireTransaction(transaction) {
  if (!transaction || transaction.kind !== 'bitcoin-signet-final-transaction') throw new TypeError('A deterministic Bitcoin final transaction is required.');
  if (transaction.networkRef !== 'bitcoin:signet' || transaction.broadcastAuthorized !== false) throw new Error('Bitcoin Core cross-check transaction authority boundary is invalid.');
  const raw = Buffer.from(transaction.rawHex ?? '', 'hex');
  if (!raw.length || raw.toString('hex') !== transaction.rawHex) throw new TypeError('Final transaction rawHex must be canonical non-empty hex.');
  return raw;
}

function normalizeNode(node, expectedNodeVersion) {
  if (node?.chain !== 'signet') throw new Error('Bitcoin Core cross-check requires Signet chain identity.');
  if (!Number.isSafeInteger(expectedNodeVersion) || expectedNodeVersion < 1) throw new TypeError('expectedNodeVersion must be a positive safe integer.');
  if (node?.version !== expectedNodeVersion) throw new Error(`Bitcoin Core version must equal pinned value ${expectedNodeVersion}.`);
  if (typeof node?.subversion !== 'string' || !node.subversion.trim()) throw new TypeError('Bitcoin Core subversion is required.');
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
  if (result.vsize !== undefined && exactInteger(result.vsize, 'mempool.vsize') !== transaction.virtualBytes) throw new Error('Bitcoin Core mempool vsize does not match extraction.');
  const rejectReason = result.allowed ? null : String(result['reject-reason'] ?? '').trim();
  if (!result.allowed && !rejectReason) throw new Error('Rejected Bitcoin Core mempool result requires reject-reason.');
  return Object.freeze({ txid:result.txid, wtxid:result.wtxid, allowed:result.allowed, vsize:result.vsize ?? transaction.virtualBytes, rejectReason });
}

export function createBitcoinCoreCrossCheckEvidence({
  transaction,
  node,
  decodedTransaction,
  mempoolResult,
  expectedNodeVersion = 310100,
  observationSource = 'offline-fixture'
}) {
  const raw = requireTransaction(transaction);
  const normalizedNode = normalizeNode(node, expectedNodeVersion);
  validateDecoded(transaction, decodedTransaction);
  const mempool = normalizeMempool(transaction, mempoolResult);
  if (!['offline-fixture', 'bitcoin-core-rpc'].includes(observationSource)) throw new TypeError('Unsupported Bitcoin Core observationSource.');
  const core = Object.freeze({
    schema:'omegavault.bitcoin.core-cross-check-evidence.v1',
    chainId:'bitcoin',
    networkRef:'bitcoin:signet',
    observationSource,
    node:normalizedNode,
    rawTransactionSha256:createHash('sha256').update(raw).digest('hex'),
    finalTransactionEvidenceSha256:transaction.finalizerEvidence.sha256,
    txid:transaction.txid,
    wtxid:transaction.wtxid,
    bytes:transaction.bytes,
    weight:transaction.weight,
    virtualBytes:transaction.virtualBytes,
    decodedTransactionMatches:true,
    mempool,
    bitcoinCoreCrossCheckProven:observationSource === 'bitcoin-core-rpc' && mempool.allowed,
    signetExecutionProven:false,
    broadcastPerformed:false,
    broadcastAuthorized:false,
    chainPromotionAuthority:false,
    authorityBoundary:'This evidence binds read-only Bitcoin Core decoding and testmempoolaccept observations to one deterministic Signet transaction. It never broadcasts, handles keys, proves inclusion/finality, or establishes immutable-rescue semantics.'
  });
  return Object.freeze({ ...core, sha256:digest(core) });
}

export function verifyBitcoinCoreCrossCheckEvidence({ evidence, ...inputs }) {
  try {
    const expected = createBitcoinCoreCrossCheckEvidence(inputs);
    const ok = JSON.stringify(evidence) === JSON.stringify(expected);
    return Object.freeze({ ok, errors:Object.freeze(ok ? [] : ['Bitcoin Core cross-check evidence does not match supplied observations.']) });
  } catch (error) {
    return Object.freeze({ ok:false, errors:Object.freeze([String(error?.message || error)]) });
  }
}

function requireMethod(driver, name) {
  if (typeof driver?.[name] !== 'function') throw new TypeError(`Bitcoin Core cross-check driver requires ${name}().`);
}

export async function runBitcoinCoreCrossCheck({ driver, transaction, expectedNodeVersion = 310100 }) {
  for (const method of ['getNetworkInfo', 'getBlockchainInfo', 'decodeRawTransaction', 'testMempoolAccept']) requireMethod(driver, method);
  const [network, blockchain] = await Promise.all([driver.getNetworkInfo(), driver.getBlockchainInfo()]);
  const node = { version:network?.version, subversion:network?.subversion, protocolVersion:network?.protocolversion, chain:blockchain?.chain };
  const decodedTransaction = await driver.decodeRawTransaction({ rawHex:transaction.rawHex, networkRef:'bitcoin:signet' });
  const results = await driver.testMempoolAccept({ rawTransactions:[transaction.rawHex], maxFeeRate:0, networkRef:'bitcoin:signet' });
  if (!Array.isArray(results) || results.length !== 1) throw new Error('Bitcoin Core testmempoolaccept must return exactly one result.');
  return createBitcoinCoreCrossCheckEvidence({ transaction, node, decodedTransaction, mempoolResult:results[0], expectedNodeVersion, observationSource:'bitcoin-core-rpc' });
}
