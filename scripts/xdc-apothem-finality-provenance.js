#!/usr/bin/env node
/**
 * Read-only XDC Apothem finality observation. Two allowlisted RPC transports
 * must agree on transaction receipt, canonical inclusion and finalized tag.
 *
 * This is cross-provider observation, not a signed consensus certificate:
 * endpoints may share infrastructure and JSON-RPC data are unauthenticated.
 * Neither this script nor its output grants production or recovery promotion.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { APOTHEM_ENDPOINTS } from './xdc-apothem-independent-rpc-check.js';
import { getNetwork } from '../src/chains/network-registry.js';
import { createXdcProvenanceBoundFinality } from '../src/chains/evm/xdc-finality-provenance-binding.js';

const HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const ALLOWED = new Set(['eth_chainId','eth_blockNumber','eth_getTransactionReceipt','eth_getBlockByNumber']);

function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value))
    throw new TypeError(label + ' must be a 32-byte hex hash');
  return value.toLowerCase();
}
function quantity(value, label) {
  if (typeof value !== 'string' || !QUANTITY.test(value))
    throw new TypeError(label + ' must be a canonical hex quantity');
  return BigInt(value);
}
function block(value, label) {
  const number = quantity(value?.number, label + '.number');
  const blockHash = hash(value?.hash, label + '.hash');
  const timestamp = quantity(value?.timestamp, label + '.timestamp');
  if (!number || !timestamp) throw new Error(label + ' must be a non-genesis block');
  return Object.freeze({ number, hash: blockHash, timestamp });
}
function sameBlock(a,b) {
  return a.number === b.number && a.hash === b.hash && a.timestamp === b.timestamp;
}
function receipt(value, txHash, label) {
  const transactionHash = hash(value?.transactionHash, label + '.transactionHash');
  const blockHash = hash(value?.blockHash, label + '.blockHash');
  const blockNumber = quantity(value?.blockNumber, label + '.blockNumber');
  if (transactionHash !== txHash || value?.status !== '0x1' || blockNumber === 0n)
    throw new Error(label + ' does not prove successful inclusion of the requested transaction');
  return Object.freeze({ transactionHash, blockHash, blockNumber, status: '0x1' });
}
function canonicalHeight(number) { return '0x' + number.toString(16); }
function checkFresh(timestamp, clock, label) {
  if (clock - timestamp > 900n) throw new Error(label + ' older than 15 minutes');
  if (timestamp - clock > 120n) throw new Error(label + ' more than 2 minutes in the future');
}

export async function observeApothemFinalityProvenance({
  transactionHash, fetchImpl = globalThis.fetch, nowSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  const txHash = hash(transactionHash, 'transactionHash');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch transport is required');
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0)
    throw new TypeError('nowSeconds must be a positive safe integer');
  if (APOTHEM_ENDPOINTS.length !== 2 || new Set(APOTHEM_ENDPOINTS).size !== 2)
    throw new Error('Two distinct fixed Apothem RPC URLs are required');
  const network = getNetwork('xdc:apothem');
  if (network?.chainIdHex !== '0x33' || network?.environment !== 'testnet')
    throw new Error('Apothem profile must be fixed to chain 51 testnet');

  let nextId = 0;
  async function rpc(endpoint, method, params = []) {
    if (!APOTHEM_ENDPOINTS.includes(endpoint) || !ALLOWED.has(method))
      throw new Error('RPC method or endpoint is not allowlisted');
    const id = ++nextId;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        // Reject redirects: an allowlisted source URL alone cannot pin the actual receiver.
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      throw new Error('Apothem read-only transport unavailable: ' + String(error?.message ?? error));
    }
    if (typeof response?.url === 'string' && new URL(response.url).href !== new URL(endpoint).href)
      throw new Error('Apothem finality RPC response redirected outside pinned endpoint');
    if (response?.ok !== true) throw new Error('Apothem provider HTTP failure: ' + String(response?.status ?? 'unknown'));
    let body;
    try { body = await response.json(); } catch { throw new Error('Apothem provider returned invalid JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' ||
        body.id !== id || Object.hasOwn(body,'error') || !Object.hasOwn(body,'result'))
      throw new Error('Apothem provider response identity or result malformed');
    return body.result;
  }
  function both(method, params = []) {
    return Promise.all(APOTHEM_ENDPOINTS.map(endpoint => rpc(endpoint, method, params)));
  }
  async function checkChainIdentity() {
    const ids = await both('eth_chainId');
    if (ids.some((id, i) => quantity(id, 'chain ID ' + i) !== 51n))
      throw new Error('Apothem provider chain mismatch');
  }

  await checkChainIdentity();
  const heads = (await both('eth_blockNumber')).map((v,i)=>quantity(v,'head ' + i));
  if (heads.some(n=>n===0n)) throw new Error('Apothem head must be non-genesis');
  const headSkew = heads[0] > heads[1] ? heads[0] - heads[1] : heads[1] - heads[0];
  if (headSkew > 12n) throw new Error('Apothem latest-head divergence exceeds 12 blocks');

  const receipts = (await both('eth_getTransactionReceipt',[txHash]))
    .map((raw,i)=>receipt(raw,txHash,'receipt '+i));
  const found = receipts[0];
  if (receipts[1].blockNumber !== found.blockNumber ||
      receipts[1].blockHash !== found.blockHash)
    throw new Error('Apothem provider receipt inclusion mismatch');

  const inclusionTag = canonicalHeight(found.blockNumber);
  const inclusionBlocks = (await both('eth_getBlockByNumber',[inclusionTag,false]))
    .map((raw,i)=>block(raw,'inclusion '+i));
  for (const included of inclusionBlocks) {
    if (included.number !== found.blockNumber || included.hash !== found.blockHash)
      throw new Error('Apothem receipt not on common canonical block');
  }
  if (!sameBlock(...inclusionBlocks))
    throw new Error('Apothem provider inclusion timestamps disagree');

  const finalizedBlocks = (await both('eth_getBlockByNumber',['finalized',false]))
    .map((raw,i)=>block(raw,'finalized '+i));
  const finalized = finalizedBlocks[0];
  if (!sameBlock(...finalizedBlocks))
    throw new Error('Apothem finalized-head disagreement across providers');
  if (finalized.number < found.blockNumber)
    throw new Error('Apothem recovery receipt is newer than finalized head');
  if (heads.some(n=>n < finalized.number))
    throw new Error('Apothem provider latest head is older than finalized head');
  if (finalized.number === found.blockNumber && finalized.hash !== found.blockHash)
    throw new Error('Apothem finalized head contradicts receipt block');
  checkFresh(inclusionBlocks[0].timestamp, BigInt(nowSeconds), 'Apothem receipt inclusion block');
  checkFresh(finalized.timestamp, BigInt(nowSeconds), 'Apothem finalized block');
  if (inclusionBlocks[0].timestamp > finalized.timestamp)
    throw new Error('Apothem receipt block timestamp follows finalized block');

  // Detect reorgs or provider switches during evidence collection. Recheck the
  // exact inclusion and finalized HEIGHTS, never only the mutable latest tags.
  const inclusionRechecks = (await both('eth_getBlockByNumber',[inclusionTag,false]))
    .map((raw,i)=>block(raw,'inclusion recheck '+i));
  const finalRechecks = (await both('eth_getBlockByNumber',[canonicalHeight(finalized.number),false]))
    .map((raw,i)=>block(raw,'finalized recheck '+i));
  for (const observation of inclusionRechecks) {
    if (!sameBlock(observation,inclusionBlocks[0]))
      throw new Error('Apothem receipt block changed during observation');
  }
  for (const observation of finalRechecks) {
    if (!sameBlock(observation,finalized))
      throw new Error('Apothem finalized block changed during observation');
  }
  await checkChainIdentity();

  const core = {
    schema: 'omegavault.xdc.apothem-finality-rpc-observation.v1',
    networkRef: network.id, chainIdDecimal: 51,
    observedChainIdHex: network.chainIdHex,
    transactionHash: txHash,
    endpoints: [...APOTHEM_ENDPOINTS],
    latestHeadHeights: heads.map(n=>n.toString()),
    receipt: { transactionHash: txHash, status: '0x1',
      blockNumber: inclusionTag, blockHash: found.blockHash },
    receiptBlock: { number: inclusionTag, hash: found.blockHash,
      timestamp: canonicalHeight(inclusionBlocks[0].timestamp) },
    finalizedBlock: { number: canonicalHeight(finalized.number), hash: finalized.hash,
      timestamp: canonicalHeight(finalized.timestamp) },
    receiptInclusionCrossChecked: true, finalizedTagCrossChecked: true,
    fixedHeightRecheckVerified: true, chainIdRechecked: true,
    observedAt: new Date(nowSeconds * 1000).toISOString(),
    readOnly: true, transactionSigned: false, transactionSubmitted: false,
    authenticatedConsensusCertificate: false, providerInfrastructureIndependenceProven: false,
    recoveryProven: false, readyForLiveProofPromotion: false
  };
  // Integrity checksum, not a signature or a guarantee of RPC authenticity.
  return Object.freeze({
    ...core,
    observationSha256: createHash('sha256').update(JSON.stringify(core)).digest('hex')
  });
}

/**
 * Read-only, end-to-end package construction. The returned source observation
 * remains explicitly untrusted RPC data; neither package grants promotion.
 * Caller supplies only a public transaction reference and a public proof.
 */
export async function observeAndBindApothemFinality({
  transactionHash, proof, kind, fetchImpl = globalThis.fetch,
  nowSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  if (typeof transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(transactionHash) ||
      proof?.transactionRef?.toLowerCase() !== transactionHash.toLowerCase() ||
      proof?.binding?.kind !== kind ||
      !['native-recovery','erc20-recovery'].includes(kind)) {
    throw new Error('XDC observation and recovery proof transaction/kind must match');
  }
  const observation = await observeApothemFinalityProvenance({transactionHash,fetchImpl,nowSeconds});
  const evidencePackage = createXdcProvenanceBoundFinality({observation,proof,kind});
  return Object.freeze({observation,evidencePackage});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/xdc-apothem-finality-provenance.js <public-transaction-hash>');
    process.exitCode = 2;
  } else {
    observeApothemFinalityProvenance({ transactionHash: process.argv[2] })
      .then(result => console.log(JSON.stringify(result,null,2)))
      .catch(error => { console.error('XDC_APOTHEM_FINALITY_OBSERVATION_BLOCKED:',String(error?.message ?? error));process.exitCode=1; });
  }
}
