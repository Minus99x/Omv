import test from 'node:test';
import assert from 'node:assert/strict';
import { getNetwork } from '../src/chains/network-registry.js';
import { DEFAULT_FINALITY_POLICIES } from '../src/chains/finality.js';
import { createDeploymentVerificationReport } from '../src/chains/evm/deployment-verification.js';
import { createEvmProofBinding } from '../src/chains/evm/proof-binding.js';
import { createEvmFinalityEvidence, evmFinalityMatchesProof } from '../src/chains/evm/finality-evidence.js';
import { createEvmCompatibilityReport } from '../src/chains/evm/compatibility-report.js';

const OWNER = '0x0000000000000000000000000000000000000001';
const RESCUE = '0x0000000000000000000000000000000000000002';
const CONTACT = '0x0000000000000000000000000000000000000003';
const VAULT = '0x00000000000000000000000000000000000000aa';
const TOKEN = '0x00000000000000000000000000000000000000bb';
const TX_NATIVE = `0x${'11'.repeat(32)}`;
const TX_TOKEN = `0x${'22'.repeat(32)}`;
const BLOCK = `0x${'aa'.repeat(32)}`;
const FINALIZED = `0x${'bb'.repeat(32)}`;

function deploymentFor(networkId) {
  const network = getNetwork(networkId);
  const expected = { owner: OWNER, rescueDestination: RESCUE, threshold: 1, inactivitySeconds: 60, adapterVersion: 500, trustedContacts: [CONTACT] };
  return createDeploymentVerificationReport({
    network,
    compiledRuntimeBytecode: '0x6000',
    liveRuntimeBytecode: '0x6000',
    expected,
    observed: { ...expected, contractAddress: VAULT, chainIdHex: network.chainIdHex, deploymentTxRef: `0x${'dd'.repeat(32)}` },
    observedAt: '2026-10-02T00:00:00Z'
  });
}

function proofFor(networkId, kind, transactionRef, deployment = deploymentFor(networkId)) {
  const binding = createEvmProofBinding({
    networkId,
    deploymentVerification: deployment,
    contractAddress: VAULT,
    kind,
    tokenAddress: kind === 'erc20-recovery' ? TOKEN : null
  });
  return Object.freeze({
    kind: kind === 'native-recovery' ? 'evm-native-recovery-proof' : 'evm-erc20-recovery-proof',
    success: true,
    chainId: binding.chainId,
    networkRef: binding.networkRef,
    bindingSha256: binding.sha256,
    binding,
    actions: Object.freeze([Object.freeze({
      operation: kind === 'native-recovery' ? 'recovery.execute' : 'token.recover',
      ok: true,
      result: Object.freeze({ txHash: transactionRef })
    })])
  });
}

function callsFor(networkId, transactionRef, overrides = {}) {
  const network = getNetwork(networkId);
  return {
    chainId: { method: 'eth_chainId', params: [], result: network.chainIdHex },
    receipt: { method: 'eth_getTransactionReceipt', params: [transactionRef], result: { transactionHash: transactionRef, status: '0x1', blockNumber: '0x64', blockHash: BLOCK } },
    inclusionBlock: { method: 'eth_getBlockByHash', params: [BLOCK, false], result: { number: '0x64', hash: BLOCK } },
    canonicalBlock: { method: 'eth_getBlockByNumber', params: ['0x64', false], result: { number: '0x64', hash: BLOCK } },
    finalizedBlock: { method: 'eth_getBlockByNumber', params: ['finalized', false], result: { number: '0x65', hash: FINALIZED } },
    ...overrides
  };
}

for (const [networkId, policy] of [
  ['ethereum:sepolia', DEFAULT_FINALITY_POLICIES.ethereumSepolia],
  ['xdc:apothem', DEFAULT_FINALITY_POLICIES.xdcApothem]
]) {
  test(`${networkId} finality binds chain, receipt, canonical block, finalized head and recovery proof`, () => {
    const proof = proofFor(networkId, 'native-recovery', TX_NATIVE);
    const evidence = createEvmFinalityEvidence({ networkId, policy, proof, calls: callsFor(networkId, TX_NATIVE), observedAt: '2026-10-02T12:00:00Z' });
    assert.equal(evidence.verified, true);
    assert.equal(evidence.transactionRef, TX_NATIVE);
    assert.equal(evidence.receipt.blockHash, BLOCK);
    assert.equal(evidence.finalizedHead.number, '0x65');
    assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
    assert.equal(evmFinalityMatchesProof(evidence, proof, { networkId, policy }), true);
    assert.equal(Object.isFrozen(evidence.receipt), true);
  });
}

test('finality verifier fails closed on wrong chain, failed receipt, block mismatch and unfinalized inclusion', () => {
  const networkId = 'xdc:apothem';
  const policy = DEFAULT_FINALITY_POLICIES.xdcApothem;
  const proof = proofFor(networkId, 'native-recovery', TX_NATIVE);

  assert.throws(() => createEvmFinalityEvidence({ networkId, policy, proof, calls: callsFor(networkId, TX_NATIVE, { chainId: { method: 'eth_chainId', params: [], result: '0xaa36a7' } }), observedAt: '2026-10-02T12:00:00Z' }), /chain ID/);
  assert.throws(() => createEvmFinalityEvidence({ networkId, policy, proof, calls: callsFor(networkId, TX_NATIVE, { receipt: { method: 'eth_getTransactionReceipt', params: [TX_NATIVE], result: { transactionHash: TX_NATIVE, status: '0x0', blockNumber: '0x64', blockHash: BLOCK } } }), observedAt: '2026-10-02T12:00:00Z' }), /successful execution/);
  assert.throws(() => createEvmFinalityEvidence({ networkId, policy, proof, calls: callsFor(networkId, TX_NATIVE, { inclusionBlock: { method: 'eth_getBlockByHash', params: [BLOCK, false], result: { number: '0x63', hash: BLOCK } } }), observedAt: '2026-10-02T12:00:00Z' }), /does not match/);
  assert.throws(() => createEvmFinalityEvidence({ networkId, policy, proof, calls: callsFor(networkId, TX_NATIVE, { canonicalBlock: { method: 'eth_getBlockByNumber', params: ['0x64', false], result: { number: '0x64', hash: FINALIZED } } }), observedAt: '2026-10-02T12:00:00Z' }), /not canonical/);
  assert.throws(() => createEvmFinalityEvidence({ networkId, policy, proof, calls: callsFor(networkId, TX_NATIVE, { finalizedBlock: { method: 'eth_getBlockByNumber', params: ['finalized', false], result: { number: '0x63', hash: FINALIZED } } }), observedAt: '2026-10-02T12:00:00Z' }), /newer than/);
});

test('compatibility promotion requires distinct native and ERC20 finality evidence bound to their proofs', () => {
  const networkId = 'ethereum:sepolia';
  const network = getNetwork(networkId);
  const policy = DEFAULT_FINALITY_POLICIES.ethereumSepolia;
  const deployment = deploymentFor(networkId);
  const nativeProof = proofFor(networkId, 'native-recovery', TX_NATIVE, deployment);
  const erc20Proof = proofFor(networkId, 'erc20-recovery', TX_TOKEN, deployment);
  const native = createEvmFinalityEvidence({ networkId, policy, proof: nativeProof, calls: callsFor(networkId, TX_NATIVE), observedAt: '2026-10-02T12:00:00Z' });
  const erc20 = createEvmFinalityEvidence({ networkId, policy, proof: erc20Proof, calls: callsFor(networkId, TX_TOKEN), observedAt: '2026-10-02T12:00:01Z' });
  const report = createEvmCompatibilityReport({
    networkId,
    observations: { chainIdHex: network.chainIdHex, rpcRead: true, walletNetworkSwitch: true },
    deploymentVerification: deployment,
    nativeProof,
    erc20Proof,
    finality: { native, erc20 }
  });
  assert.equal(report.checks['finality-evidence'], true);
  assert.deepEqual(report.finalityEvidenceSha256, { native: native.sha256, erc20: erc20.sha256 });
  assert.equal(report.readyForLiveProofPromotion, true);

  const crossWired = createEvmCompatibilityReport({
    networkId,
    observations: { chainIdHex: network.chainIdHex, rpcRead: true, walletNetworkSwitch: true },
    deploymentVerification: deployment,
    nativeProof,
    erc20Proof,
    finality: { native: erc20, erc20: native }
  });
  assert.equal(crossWired.checks['finality-evidence'], false);
  assert.equal(crossWired.readyForLiveProofPromotion, false);
});

test('mutated finality evidence digest or proof binding is rejected', () => {
  const networkId = 'ethereum:sepolia';
  const policy = DEFAULT_FINALITY_POLICIES.ethereumSepolia;
  const proof = proofFor(networkId, 'native-recovery', TX_NATIVE);
  const evidence = createEvmFinalityEvidence({ networkId, policy, proof, calls: callsFor(networkId, TX_NATIVE), observedAt: '2026-10-02T12:00:00Z' });
  assert.equal(evmFinalityMatchesProof({ ...evidence, observedAt: '2026-10-02T13:00:00.000Z' }, proof, { networkId, policy }), false);
  assert.equal(evmFinalityMatchesProof({ ...evidence, proofBindingSha256: '0'.repeat(64) }, proof, { networkId, policy }), false);
});
