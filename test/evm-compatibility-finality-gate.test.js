import test from 'node:test';
import assert from 'node:assert/strict';
import { getNetwork } from '../src/chains/network-registry.js';
import { createDeploymentVerificationReport } from '../src/chains/evm/deployment-verification.js';
import { createEvmProofBinding } from '../src/chains/evm/proof-binding.js';
import { createEvmBlockFinalityEvidence } from '../src/chains/evm/finality-evidence.js';
import { createEvmCompatibilityReport } from '../src/chains/evm/compatibility-report.js';

const networkId = 'xdc:apothem';
const network = getNetwork(networkId);
const A = n => '0x' + n.toString(16).padStart(40, '0');
const TX_NATIVE = '0x' + '11'.repeat(32);
const TX_ERC20 = '0x' + '22'.repeat(32);
const BLOCK = '0x' + '33'.repeat(32);
const FINAL = '0x' + '44'.repeat(32);
const policy = {
  owner: A(1), rescueDestination: A(2), threshold: 2,
  inactivitySeconds: 60, adapterVersion: 501,
  trustedContacts: [A(3), A(4)]
};

function fixture() {
  const observed = {
    ...policy, chainIdHex: network.chainIdHex,
    contractAddress: A(9), deploymentTxRef: TX_NATIVE
  };
  const deploymentVerification = createDeploymentVerificationReport({
    network, compiledRuntimeBytecode: '0x6000', liveRuntimeBytecode: '0x6000',
    expected: policy, observed, observedAt: '2026-10-14T20:00:00Z'
  });
  assert.equal(deploymentVerification.verified, true);
  function boundProof(kind, transactionRef) {
    const binding = createEvmProofBinding({
      networkId, deploymentVerification, contractAddress: A(9),
      kind, tokenAddress: kind === 'erc20-recovery' ? A(10) : null
    });
    return {
      success: true, chainId: network.chainId, networkRef: network.id,
      transactionRef, binding, bindingSha256: binding.sha256
    };
  }
  const nativeProof = boundProof('native-recovery', TX_NATIVE);
  const erc20Proof = boundProof('erc20-recovery', TX_ERC20);
  function finalized(proof) {
    return createEvmBlockFinalityEvidence({
      networkId, proof, observedChainIdHex: network.chainIdHex,
      receipt: { status: '0x1', transactionHash: proof.transactionRef,
        blockNumber: '0x2a', blockHash: BLOCK },
      receiptBlock: { number: '0x2a', hash: BLOCK },
      finalizedBlock: { number: '0x2b', hash: FINAL },
      observedAt: '2026-10-14T20:00:00Z'
    });
  }
  const finality = {
    nativeRecovery: finalized(nativeProof),
    erc20Recovery: finalized(erc20Proof)
  };
  const observations = {
    chainIdHex: network.chainIdHex, rpcRead: true, walletNetworkSwitch: true
  };
  const report = (overrides = {}) => createEvmCompatibilityReport({
    networkId, observations, deploymentVerification, nativeProof, erc20Proof,
    finality, ...overrides
  });
  return { report, nativeProof, erc20Proof, finality };
}

test('XDC compatibility requires distinct proof-bound native and ERC-20 finalized receipts', () => {
  const f = fixture();
  const outcome = f.report();
  assert.equal(outcome.checks['finality-evidence'], true);
  assert.deepEqual(outcome.missing, []);
  assert.equal(outcome.readyForLiveProofPromotion, true);
});

test('bare or unbound finalized status does not authorize XDC recovery promotion', () => {
  const f = fixture();
  for (const finality of [
    { status: 'finalized' },
    { nativeRecovery: { status: 'finalized' }, erc20Recovery: { status: 'finalized' } },
    { nativeRecovery: f.finality.nativeRecovery },
    { erc20Recovery: f.finality.erc20Recovery },
    null
  ]) {
    const outcome = f.report({ finality });
    assert.equal(outcome.checks['finality-evidence'], false);
    assert.ok(outcome.missing.includes('finality-evidence'));
    assert.equal(outcome.readyForLiveProofPromotion, false);
  }
});

test('two finality receipts cannot be swapped between native and token recovery proofs', () => {
  const f = fixture();
  const swapped = f.report({ finality: {
    nativeRecovery: f.finality.erc20Recovery,
    erc20Recovery: f.finality.nativeRecovery
  } });
  assert.equal(swapped.checks['finality-evidence'], false);
  assert.equal(swapped.readyForLiveProofPromotion, false);
});

test('a native proof finalization cannot substitute for ERC-20 finalization', () => {
  const f = fixture();
  const outcome = f.report({ finality: {
    nativeRecovery: f.finality.nativeRecovery,
    erc20Recovery: f.finality.nativeRecovery
  } });
  assert.equal(outcome.checks['finality-evidence'], false);
  assert.equal(outcome.readyForLiveProofPromotion, false);
});

test('tampered finality hashes, crosswired bindings and missing recovery proof fail closed', () => {
  const f = fixture();
  const altered = f.report({ finality: {
    ...f.finality, erc20Recovery: {
      ...f.finality.erc20Recovery, receipt: {
        ...f.finality.erc20Recovery.receipt,
        canonicalBlockHash: '0x' + 'ff'.repeat(32)
      }
    }
  } });
  assert.equal(altered.readyForLiveProofPromotion, false);
  assert.equal(f.report({ erc20Proof: { ...f.erc20Proof, bindingSha256: 'b'.repeat(64) } })
    .checks['finality-evidence'], false);
  assert.equal(f.report({ nativeProof: null }).readyForLiveProofPromotion, false);
});
