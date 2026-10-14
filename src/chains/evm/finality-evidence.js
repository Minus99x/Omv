import { createHash } from 'node:crypto';
import { getNetwork } from '../network-registry.js';
import { DEFAULT_FINALITY_POLICIES } from '../finality.js';

const HASH_32 = /^0x[0-9a-f]{64}$/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizeHash(value, label) {
  if (typeof value !== 'string' || !HASH_32.test(value)) throw new TypeError(`${label} must be a 32-byte 0x-prefixed hash.`);
  return value.toLowerCase();
}

function quantity(value, label) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new TypeError(`${label} must be non-negative.`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`);
    return BigInt(value);
  }
  if (typeof value === 'string' && (/^0x[0-9a-f]+$/i.test(value) || /^\d+$/.test(value))) {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new TypeError(`${label} must be non-negative.`);
    return parsed;
  }
  throw new TypeError(`${label} must be an integer-like EVM quantity.`);
}

function receiptSucceeded(status) {
  return status === true || status === 1 || status === 1n || status === '1' || String(status).toLowerCase() === '0x1';
}

function policyForNetwork(networkRef) {
  return Object.values(DEFAULT_FINALITY_POLICIES).find(policy => policy.networkRef === networkRef) ?? null;
}

function validateProofBinding(proof, network) {
  if (proof?.success !== true) throw new Error('Finality evidence requires a successful recovery proof.');
  if (proof.networkRef !== network.id || proof.chainId !== network.chainId) throw new Error('Recovery proof belongs to a different EVM network.');
  if (typeof proof.bindingSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(proof.bindingSha256)) throw new TypeError('Recovery proof requires a binding SHA-256 digest.');
  if (proof.binding?.sha256 !== proof.bindingSha256) throw new Error('Recovery proof binding digest is inconsistent.');
  if (typeof proof.binding?.contextSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(proof.binding.contextSha256)) throw new TypeError('Recovery proof requires a proof-context digest.');
  if (typeof proof.binding?.deploymentVerificationSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(proof.binding.deploymentVerificationSha256)) throw new TypeError('Recovery proof requires a deployment-verification digest.');
  return normalizeHash(proof.transactionRef, 'proof.transactionRef');
}

export function createEvmBlockFinalityEvidence({
  networkId,
  proof,
  observedChainIdHex,
  receipt,
  receiptBlock = null,
  finalizedBlock = null,
  latestBlock = null,
  observedAt
}) {
  const network = getNetwork(networkId);
  if (!network || network.rpcProtocol !== 'evm-json-rpc') throw new TypeError('EVM finality evidence requires a registered EVM JSON-RPC network.');
  const policy = policyForNetwork(network.id);
  if (!policy || policy.model !== 'evm-block') throw new Error('This finality evidence builder supports evm-block policies only.');
  if (String(observedChainIdHex ?? '').toLowerCase() !== String(network.chainIdHex).toLowerCase()) throw new Error('Observed EVM chain ID does not match the selected network.');
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) throw new TypeError('observedAt must be an ISO-compatible timestamp.');

  const transactionRef = validateProofBinding(proof, network);
  if (!receiptSucceeded(receipt?.status)) throw new Error('Transaction receipt does not report success.');
  const receiptTx = normalizeHash(receipt?.transactionHash, 'receipt.transactionHash');
  if (receiptTx !== transactionRef) throw new Error('Finality receipt belongs to a different recovery transaction.');
  const receiptBlockHash = normalizeHash(receipt?.blockHash, 'receipt.blockHash');
  const receiptBlockNumber = quantity(receipt?.blockNumber, 'receipt.blockNumber');
  // The receipt alone is not proof that its block is still canonical.
  // Caller must provide an independently requested eth_getBlockByNumber
  // observation at the receipt's height, not a second copy of the receipt.
  if (!receiptBlock) throw new Error('Finality evidence requires a canonical receipt-block observation.');
  const canonicalReceiptHeight = quantity(receiptBlock.number, 'receiptBlock.number');
  const canonicalReceiptHash = normalizeHash(receiptBlock.hash, 'receiptBlock.hash');
  if (canonicalReceiptHeight !== receiptBlockNumber || canonicalReceiptHash !== receiptBlockHash) {
    throw new Error('Recovery receipt is not bound to the observed canonical block.');
  }

  let method;
  let confirmationCount = null;
  let finalizedBlockNumber = null;
  let finalizedBlockHash = null;
  let headBlockNumber = null;

  const finalizedTagRequired = policy.target?.finalizedBlockTag === true || policy.target?.finalizedBlockTagPreferred === true;
  const confirmationsRequired = Number(policy.target?.confirmations ?? 0);

  if (finalizedTagRequired) {
    if (!finalizedBlock) throw new Error('This EVM finality policy requires evidence from the finalized block tag.');
    finalizedBlockNumber = quantity(finalizedBlock.number, 'finalizedBlock.number');
    finalizedBlockHash = normalizeHash(finalizedBlock.hash, 'finalizedBlock.hash');
    if (finalizedBlockNumber < receiptBlockNumber) throw new Error('Recovery transaction block is newer than the finalized chain head.');
    if (finalizedBlockNumber === receiptBlockNumber && finalizedBlockHash !== receiptBlockHash) {
      throw new Error('Finalized head hash contradicts recovery receipt block.');
    }
    method = 'finalized-tag';
  } else if (confirmationsRequired > 0) {
    if (!latestBlock) throw new Error('This EVM finality policy requires a latest-block observation for confirmation counting.');
    headBlockNumber = quantity(latestBlock.number, 'latestBlock.number');
    if (headBlockNumber < receiptBlockNumber) throw new Error('Latest EVM block is older than the recovery receipt block.');
    confirmationCount = headBlockNumber - receiptBlockNumber + 1n;
    if (confirmationCount < BigInt(confirmationsRequired)) throw new Error(`Recovery transaction has fewer than ${confirmationsRequired} required confirmations.`);
    method = 'confirmations';
  } else {
    throw new Error('EVM finality policy has no implemented finality requirement.');
  }

  const core = Object.freeze({
    schema: 'omegavault.evm-finality-evidence.v2',
    chainId: network.chainId,
    networkRef: network.id,
    chainIdHex: String(network.chainIdHex).toLowerCase(),
    model: policy.model,
    method,
    transactionRef,
    proofBindingSha256: proof.bindingSha256.toLowerCase(),
    proofContextSha256: proof.binding.contextSha256.toLowerCase(),
    deploymentVerificationSha256: proof.binding.deploymentVerificationSha256.toLowerCase(),
    receipt: Object.freeze({
      blockNumber: receiptBlockNumber.toString(),
      blockHash: receiptBlockHash,
      canonicalBlockNumber: canonicalReceiptHeight.toString(),
      canonicalBlockHash: canonicalReceiptHash,
      status: 'success'
    }),
    finality: Object.freeze({
      finalizedBlockNumber: finalizedBlockNumber?.toString() ?? null,
      finalizedBlockHash,
      headBlockNumber: headBlockNumber?.toString() ?? null,
      confirmations: confirmationCount?.toString() ?? null,
      requiredConfirmations: confirmationsRequired || null
    }),
    observedAt,
    status: 'finalized'
  });
  return Object.freeze({ ...core, sha256: digest(core) });
}

export function evmFinalityMatchesProof(evidence, proof, { networkId, kind }) {
  const network = getNetwork(networkId);
  if (!network || !evidence || !proof || proof?.success !== true) return false;
  if (proof?.binding?.kind !== kind) return false;
  if (evidence.schema !== 'omegavault.evm-finality-evidence.v2' || evidence.status !== 'finalized') return false;
  if (evidence.networkRef !== network.id || evidence.chainId !== network.chainId) return false;
  if (evidence.chainIdHex !== String(network.chainIdHex).toLowerCase()) return false;
  // A checksum is not an independent ledger proof. Reject internally
  // inconsistent or policy-incompatible evidence even when re-hashed.
  const policy = policyForNetwork(network.id);
  if (!policy || policy.model !== 'evm-block' || evidence.receipt?.status !== 'success') return false;
  try {
    const receiptHeight = quantity(evidence.receipt.blockNumber, 'receipt.blockNumber');
    if (quantity(evidence.receipt.canonicalBlockNumber, 'receipt.canonicalBlockNumber') !== receiptHeight) return false;
    if (normalizeHash(evidence.receipt.blockHash, 'receipt.blockHash') !==
        normalizeHash(evidence.receipt.canonicalBlockHash, 'receipt.canonicalBlockHash')) return false;
    const needsFinalized = policy.target?.finalizedBlockTag === true ||
      policy.target?.finalizedBlockTagPreferred === true;
    if (needsFinalized) {
      if (evidence.method !== 'finalized-tag') return false;
      const height = quantity(evidence.finality?.finalizedBlockNumber, 'finalizedBlockNumber');
      const hash = normalizeHash(evidence.finality?.finalizedBlockHash, 'finalizedBlockHash');
      if (height < receiptHeight || (height === receiptHeight && hash !== evidence.receipt.blockHash)) return false;
    } else {
      const required = Number(policy.target?.confirmations ?? 0);
      if (!Number.isSafeInteger(required) || required < 1 || evidence.method !== 'confirmations') return false;
      const head = quantity(evidence.finality?.headBlockNumber, 'headBlockNumber');
      const count = quantity(evidence.finality?.confirmations, 'confirmations');
      if (head < receiptHeight || count !== head - receiptHeight + 1n || count < BigInt(required) ||
          evidence.finality?.requiredConfirmations !== required) return false;
    }
  } catch { return false; }
  if (evidence.transactionRef !== String(proof.transactionRef ?? '').toLowerCase()) return false;
  if (evidence.proofBindingSha256 !== proof.bindingSha256) return false;
  if (evidence.proofContextSha256 !== proof.binding?.contextSha256) return false;
  if (evidence.deploymentVerificationSha256 !== proof.binding?.deploymentVerificationSha256) return false;
  if (typeof evidence.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(evidence.sha256)) return false;
  const { sha256, ...unsigned } = evidence;
  return digest(unsigned) === sha256;
}
