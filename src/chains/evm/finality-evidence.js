import { createHash } from 'node:crypto';
import { getNetwork } from '../network-registry.js';

const HASH32 = /^0x[0-9a-f]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const SUPPORTED_NETWORKS = new Set(['ethereum:sepolia', 'xdc:apothem']);

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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hash32(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!HASH32.test(normalized)) throw new TypeError(`${label} must be a 32-byte 0x hash.`);
  return normalized;
}

function quantity(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!QUANTITY.test(normalized)) throw new TypeError(`${label} must be a canonical EVM quantity.`);
  return { hex: normalized, value: BigInt(normalized) };
}

function requireCall(call, method, params, label) {
  if (call?.method !== method || JSON.stringify(call?.params ?? null) !== JSON.stringify(params)) {
    throw new Error(`${label} must bind the exact ${method} request.`);
  }
  if (call.error != null) throw new Error(`${label} returned an RPC error.`);
  return call.result;
}

function proofTransactionRef(proof) {
  const operation = proof?.kind === 'evm-native-recovery-proof' ? 'recovery.execute'
    : proof?.kind === 'evm-erc20-recovery-proof' ? 'token.recover'
      : null;
  if (!operation || proof?.success !== true) throw new Error('Finality evidence requires a successful EVM recovery proof.');
  const matches = (proof.actions ?? []).filter(action => action?.operation === operation && action?.ok === true);
  if (matches.length !== 1) throw new Error(`Recovery proof must contain exactly one successful ${operation} action.`);
  return hash32(matches[0]?.result?.txHash, `${operation} transaction hash`);
}

function policyDigest(policy) {
  return digest({
    chainId: policy.chainId,
    networkRef: policy.networkRef,
    model: policy.model,
    target: policy.target,
    evidenceFields: policy.evidenceFields
  });
}

export function createEvmFinalityEvidence({ networkId, policy, proof, calls, observedAt }) {
  const network = getNetwork(networkId);
  if (!network || network.rpcProtocol !== 'evm-json-rpc') throw new TypeError('EVM finality evidence requires a registered EVM network.');
  if (!SUPPORTED_NETWORKS.has(network.id)) throw new Error('This finality verifier currently supports Ethereum Sepolia and XDC Apothem only.');
  if (policy?.chainId !== network.chainId || policy?.networkRef !== network.id || policy?.model !== 'evm-block') {
    throw new Error('Finality policy does not match the requested EVM network.');
  }
  if (!proof?.binding || proof.bindingSha256 !== proof.binding.sha256) throw new Error('Finality evidence requires an intact proof binding.');
  if (proof.networkRef !== network.id || proof.chainId !== network.chainId) throw new Error('Recovery proof belongs to a different network.');
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) throw new TypeError('observedAt must be an ISO-compatible timestamp.');

  const transactionRef = proofTransactionRef(proof);
  const observedChainId = String(requireCall(calls?.chainId, 'eth_chainId', [], 'chainId call') ?? '').toLowerCase();
  if (observedChainId !== String(network.chainIdHex).toLowerCase()) throw new Error('RPC chain ID does not match the selected network.');

  const receipt = requireCall(calls?.receipt, 'eth_getTransactionReceipt', [transactionRef], 'receipt call');
  if (!receipt || String(receipt.transactionHash ?? '').toLowerCase() !== transactionRef) throw new Error('Receipt transaction hash mismatch.');
  if (String(receipt.status ?? '').toLowerCase() !== '0x1') throw new Error('Receipt does not prove successful execution.');
  const receiptBlockHash = hash32(receipt.blockHash, 'receipt.blockHash');
  const receiptBlockNumber = quantity(receipt.blockNumber, 'receipt.blockNumber');

  const inclusion = requireCall(calls?.inclusionBlock, 'eth_getBlockByHash', [receiptBlockHash, false], 'inclusion block call');
  if (!inclusion) throw new Error('Receipt block is not available from the RPC endpoint.');
  const inclusionHash = hash32(inclusion.hash, 'inclusionBlock.hash');
  const inclusionNumber = quantity(inclusion.number, 'inclusionBlock.number');
  if (inclusionHash !== receiptBlockHash || inclusionNumber.value !== receiptBlockNumber.value) {
    throw new Error('Receipt block does not match independently queried canonical block evidence.');
  }

  const canonical = requireCall(calls?.canonicalBlock, 'eth_getBlockByNumber', [receiptBlockNumber.hex, false], 'canonical block call');
  if (!canonical) throw new Error('RPC endpoint did not return the receipt height from its canonical chain.');
  const canonicalHash = hash32(canonical.hash, 'canonicalBlock.hash');
  const canonicalNumber = quantity(canonical.number, 'canonicalBlock.number');
  if (canonicalHash !== receiptBlockHash || canonicalNumber.value !== receiptBlockNumber.value) {
    throw new Error('Receipt block is not canonical at its declared height.');
  }

  const finalized = requireCall(calls?.finalizedBlock, 'eth_getBlockByNumber', ['finalized', false], 'finalized block call');
  if (!finalized) throw new Error('RPC endpoint did not return a finalized block.');
  const finalizedHash = hash32(finalized.hash, 'finalizedBlock.hash');
  const finalizedNumber = quantity(finalized.number, 'finalizedBlock.number');
  if (finalizedNumber.value < receiptBlockNumber.value) throw new Error('Recovery transaction is newer than the finalized head.');

  const body = {
    schema: 'omegavault.evm-finality-evidence.v1',
    verified: true,
    chainId: network.chainId,
    networkRef: network.id,
    chainIdHex: observedChainId,
    model: policy.model,
    finalityPolicySha256: policyDigest(policy),
    transactionRef,
    proofBindingSha256: proof.bindingSha256,
    proofContextSha256: proof.binding.contextSha256,
    deploymentVerificationSha256: proof.binding.deploymentVerificationSha256,
    observedAt: new Date(observedAt).toISOString(),
    receipt: { status: '0x1', blockNumber: receiptBlockNumber.hex, blockHash: receiptBlockHash },
    finalizedHead: { number: finalizedNumber.hex, hash: finalizedHash, tag: 'finalized' },
    rpcMethods: ['eth_chainId', 'eth_getTransactionReceipt', 'eth_getBlockByHash', 'eth_getBlockByNumber:receipt-height', 'eth_getBlockByNumber:finalized']
  };
  return deepFreeze({ ...body, sha256: digest(body) });
}

export function evmFinalityMatchesProof(evidence, proof, { networkId, policy }) {
  try {
    const network = getNetwork(networkId);
    if (!network || evidence?.verified !== true || evidence?.schema !== 'omegavault.evm-finality-evidence.v1') return false;
    if (evidence.networkRef !== network.id || evidence.chainId !== network.chainId) return false;
    if (evidence.chainIdHex !== String(network.chainIdHex).toLowerCase()) return false;
    if (policy?.networkRef !== network.id || policy?.chainId !== network.chainId) return false;
    if (evidence.finalityPolicySha256 !== policyDigest(policy)) return false;
    if (evidence.transactionRef !== proofTransactionRef(proof)) return false;
    if (evidence.proofBindingSha256 !== proof.bindingSha256) return false;
    if (evidence.proofContextSha256 !== proof.binding?.contextSha256) return false;
    if (evidence.deploymentVerificationSha256 !== proof.binding?.deploymentVerificationSha256) return false;
    const { sha256, ...unsigned } = evidence;
    return typeof sha256 === 'string' && digest(unsigned) === sha256;
  } catch {
    return false;
  }
}
