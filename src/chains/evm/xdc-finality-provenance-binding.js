import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { createEvmBlockFinalityEvidence, evmFinalityMatchesProof } from './finality-evidence.js';

// This validates the internal consistency and source *claims* of the two-RPC
// observation. It does NOT authenticate the RPC operators or blockchain state.
const ENDPOINTS = Object.freeze([
  'https://rpc.apothem.network', 'https://erpc.apothem.network'
]);
const HEX_HASH = /^0x[0-9a-f]{64}$/;
const HEX_NUMBER = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const DEC_NUMBER = /^(?:0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_EVM_QUANTITY = (1n << 256n) - 1n;
const KINDS = new Set(['native-recovery', 'erc20-recovery']);
const REPORT_KEYS = [
  'schema','networkRef','chainIdDecimal','observedChainIdHex','transactionHash',
  'endpoints','latestHeadHeights','receipt','receiptBlock','finalizedBlock',
  'receiptInclusionCrossChecked','finalizedTagCrossChecked','fixedHeightRecheckVerified',
  'chainIdRechecked','observedAt','readOnly','transactionSigned',
  'transactionSubmitted','authenticatedConsensusCertificate',
  'providerInfrastructureIndependenceProven','recoveryProven',
  'readyForLiveProofPromotion','observationSha256'
];

function sha256(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
function keysMatch(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value,key)) &&
    Object.keys(value).every(key => keys.includes(key));
}
function assertKeys(value, keys, label) {
  if (!keysMatch(value,keys)) throw new Error(label + ' has missing or unexpected fields');
}
function quantity(value, label) {
  if (typeof value !== 'string' || !HEX_NUMBER.test(value))
    throw new TypeError(label + ' must be canonical hex');
  const parsed = BigInt(value);
  if (parsed > MAX_EVM_QUANTITY) throw new TypeError(label + ' exceeds uint256');
  return parsed;
}
function decimal(value, label) {
  if (typeof value !== 'string' || !DEC_NUMBER.test(value))
    throw new TypeError(label + ' must be canonical decimal');
  const parsed = BigInt(value);
  if (parsed > MAX_EVM_QUANTITY) throw new TypeError(label + ' exceeds uint256');
  return parsed;
}
function hash(value,label) {
  if (typeof value !== 'string' || !HEX_HASH.test(value))
    throw new TypeError(label + ' must be lower-case 32-byte hex');
  if (/^0x0{64}$/.test(value))
    throw new Error(label + ' cannot be an all-zero hash');
  return value;
}
function flag(value,expected,label) {
  if (value !== expected) throw new Error(label + ' must be ' + String(expected));
}
function freshAtObservedTime(value, observedSeconds, label) {
  const stamp = quantity(value,label);
  if (stamp === 0n || observedSeconds - stamp > 900n || stamp - observedSeconds > 120n)
    throw new Error(label + ' falls outside observation freshness bounds');
  return stamp;
}

export function validateXdcFinalityRpcObservation(observation) {
  assertKeys(observation,REPORT_KEYS,'XDC finality observation');
  if (observation.schema !== 'omegavault.xdc.apothem-finality-rpc-observation.v1' ||
      observation.networkRef !== 'xdc:apothem' ||
      observation.chainIdDecimal !== 51 || observation.observedChainIdHex !== '0x33')
    throw new Error('XDC finality observation network identity mismatch');
  if (!Array.isArray(observation.endpoints) ||
      observation.endpoints.length !== 2 ||
      ENDPOINTS.some((endpoint,i)=>!Object.hasOwn(observation.endpoints,i) || observation.endpoints[i]!==endpoint))
    throw new Error('XDC finality observation requires both ordered fixed endpoints');
  if (!Array.isArray(observation.latestHeadHeights) ||
      observation.latestHeadHeights.length !== 2 ||
      ![0,1].every(i=>Object.hasOwn(observation.latestHeadHeights,i)))
    throw new Error('XDC finality observation requires two latest head heights');
  const heads = observation.latestHeadHeights.map((height,i)=>decimal(height,'latestHeadHeights['+i+']'));
  if (heads.some(height=>height<=0n)) throw new Error('XDC latest heads must be non-genesis');
  const skew = heads[0] > heads[1] ? heads[0]-heads[1] : heads[1]-heads[0];
  if (skew > 12n) throw new Error('XDC latest-head divergence exceeds 12 blocks');
  const tx = hash(observation.transactionHash,'transactionHash');
  assertKeys(observation.receipt,['transactionHash','status','blockNumber','blockHash'],'receipt');
  if (hash(observation.receipt.transactionHash,'receipt transactionHash')!==tx ||
      observation.receipt.status!=='0x1')
    throw new Error('XDC recovery receipt is not a matching successful transaction');
  const receiptHeight = quantity(observation.receipt.blockNumber,'receipt blockNumber');
  const receiptHash = hash(observation.receipt.blockHash,'receipt blockHash');
  if (receiptHeight<=0n || heads.some(height=>height<receiptHeight))
    throw new Error('XDC receipt cannot be newer than the observed provider heads');
  assertKeys(observation.receiptBlock,['number','hash','timestamp'],'receiptBlock');
  const receiptBlockHeight = quantity(observation.receiptBlock.number,'receiptBlock.number');
  const receiptBlockHash = hash(observation.receiptBlock.hash,'receiptBlock.hash');
  if (receiptBlockHeight!==receiptHeight || receiptBlockHash!==receiptHash)
    throw new Error('XDC receipt inclusion does not match canonical receipt block');
  assertKeys(observation.finalizedBlock,['number','hash','timestamp'],'finalizedBlock');
  const finalizedHeight = quantity(observation.finalizedBlock.number,'finalizedBlock.number');
  const finalizedHash = hash(observation.finalizedBlock.hash,'finalizedBlock.hash');
  if (finalizedHeight<receiptHeight || heads.some(head=>head<finalizedHeight))
    throw new Error('XDC finalized head is incompatible with inclusion and provider heads');
  if (finalizedHeight===receiptHeight && finalizedHash!==receiptHash)
    throw new Error('XDC same-height finalized hash contradicts receipt');
  if (finalizedHeight!==receiptHeight && finalizedHash===receiptHash)
    throw new Error('XDC different-height finalized block cannot reuse receipt block hash');
  if (typeof observation.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(observation.observedAt)) ||
      new Date(observation.observedAt).toISOString() !== observation.observedAt)
    throw new TypeError('XDC observation time must be canonical UTC ISO');
  const observedMs = Date.parse(observation.observedAt);
  if (observedMs % 1000 !== 0) throw new Error('XDC observation timestamp must be in whole seconds');
  const observedSeconds = BigInt(observedMs / 1000);
  const receiptStamp = freshAtObservedTime(observation.receiptBlock.timestamp,observedSeconds,'receiptBlock.timestamp');
  const finalizedStamp = freshAtObservedTime(observation.finalizedBlock.timestamp,observedSeconds,'finalizedBlock.timestamp');
  if (finalizedHeight === receiptHeight && receiptStamp !== finalizedStamp)
    throw new Error('XDC identical inclusion and finalized block must have identical timestamps');
  if (receiptStamp > finalizedStamp)
    throw new Error('XDC receipt block timestamp cannot follow finalized block timestamp');
  for(const key of ['receiptInclusionCrossChecked','finalizedTagCrossChecked',
    'fixedHeightRecheckVerified','chainIdRechecked','readOnly']) flag(observation[key],true,key);
  for(const key of ['transactionSigned','transactionSubmitted',
    'authenticatedConsensusCertificate','providerInfrastructureIndependenceProven',
    'recoveryProven','readyForLiveProofPromotion']) flag(observation[key],false,key);
  if (typeof observation.observationSha256 !== 'string' ||
      !SHA256.test(observation.observationSha256))
    throw new TypeError('XDC observation digest must be SHA-256');
  const { observationSha256, ...unsigned } = observation;
  if (sha256(unsigned)!==observationSha256)
    throw new Error('XDC finality observation checksum mismatch');
  return Object.freeze({
    transactionHash:tx, receiptHeight:receiptHeight.toString(),
    finalizedHeight:finalizedHeight.toString(),
    observationSha256, claimsConsistent:true, rpcAuthenticated:false
  });
}

export function createXdcProvenanceBoundFinality({ observation, proof, kind }) {
  if (!KINDS.has(kind) || proof?.binding?.kind !== kind)
    throw new Error('XDC recovery proof kind is missing or inconsistent');
  const checked = validateXdcFinalityRpcObservation(observation);
  if (typeof proof?.transactionRef!=='string' ||
      proof.transactionRef.toLowerCase()!==checked.transactionHash)
    throw new Error('XDC RPC observation belongs to another recovery transaction');
  const evidence = createEvmBlockFinalityEvidence({
    networkId:'xdc:apothem',proof,
    observedChainIdHex:observation.observedChainIdHex,
    receipt:observation.receipt,receiptBlock:observation.receiptBlock,
    finalizedBlock:observation.finalizedBlock,observedAt:observation.observedAt
  });
  if (!evmFinalityMatchesProof(evidence,proof,{networkId:'xdc:apothem',kind}))
    throw new Error('XDC recovery proof is not bound to finality evidence');
  const core = {
    schema:'omegavault.xdc.provenance-bound-finality.v1',
    networkRef:'xdc:apothem',kind,transactionHash:checked.transactionHash,
    observationSha256:checked.observationSha256,
    finalityEvidence:evidence,
    rpcSourceClaimsConsistent:true,
    rpcAuthenticated:false,authenticatedConsensusCertificate:false,
    providerInfrastructureIndependenceProven:false,
    recoveryProven:false,readyForLiveProofPromotion:false
  };
  return Object.freeze({ ...core, packageSha256:sha256(core) });
}

export function xdcProvenancePackageMatchesProof(bundle, observation, proof, kind) {
  try {
    const expected = createXdcProvenanceBoundFinality({observation,proof,kind});
    // Check the entire exact package, not only separately supplied digests.
    if (!keysMatch(bundle,Object.keys(expected))) return false;
    return isDeepStrictEqual(bundle, expected);
  } catch {
    return false;
  }
}
