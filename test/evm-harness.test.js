import test from 'node:test';
import assert from 'node:assert/strict';
import { getNetwork } from '../src/chains/network-registry.js';
import { createDeploymentVerificationReport, runtimeCodeMatches } from '../src/chains/evm/deployment-verification.js';
import { createEvmCompatibilityReport } from '../src/chains/evm/compatibility-report.js';
import { createEvmProofBinding, normalizeEvmFamilyAddress } from '../src/chains/evm/proof-binding.js';
import { runEvmNativeRecoveryProof, runEvmErc20RecoveryProof } from '../src/chains/evm/recovery-test-runner.js';
import { createFinalityObservation, DEFAULT_FINALITY_POLICIES } from '../src/chains/finality.js';

const OWNER = '0x0000000000000000000000000000000000000001';
const RESCUE = '0x0000000000000000000000000000000000000002';
const CONTACT_A = '0x0000000000000000000000000000000000000003';
const CONTACT_B = '0x0000000000000000000000000000000000000004';
const VAULT = '0x00000000000000000000000000000000000000aa';
const TOKEN = '0x00000000000000000000000000000000000000bb';

function expectedConfig(threshold = 2) {
  return { owner: OWNER, rescueDestination: RESCUE, threshold, inactivitySeconds: 60, adapterVersion: 500, trustedContacts: threshold === 1 ? [CONTACT_A] : [CONTACT_A, CONTACT_B] };
}

function deploymentFor(networkId, threshold = 2, contractAddress = VAULT) {
  const network = getNetwork(networkId);
  const expected = expectedConfig(threshold);
  return createDeploymentVerificationReport({
    network,
    compiledRuntimeBytecode: '0x6000',
    liveRuntimeBytecode: '0x6000',
    expected,
    observed: { ...expected, contractAddress, chainIdHex: network.chainIdHex, deploymentTxRef: '0xdeploy' },
    observedAt: '2026-10-02T00:00:00Z'
  });
}

test('deterministic EVM deployment verifier masks immutable ranges and checks policy config', () => {
  assert.equal(runtimeCodeMatches('0x6001aabb6002', '0x6001ccdd6002', { x: [{ start: 2, length: 2 }] }), true);
  const network = getNetwork('base:sepolia');
  const expected = expectedConfig(2);
  const report = createDeploymentVerificationReport({ network, compiledRuntimeBytecode: '0x6001aabb6002', liveRuntimeBytecode: '0x6001ccdd6002', immutableReferences: { x: [{ start: 2, length: 2 }] }, expected, observed: { ...expected, contractAddress: VAULT, chainIdHex: network.chainIdHex, deploymentTxRef: '0xdeploy' }, sourceSha256: 'abc', observedAt: '2026-09-28T00:00:00Z' });
  assert.equal(report.verified, true);
  assert.match(report.sha256, /^[a-f0-9]{64}$/);
});

test('EVM-family binding normalizes XDC and 0x address prefixes to one canonical address', () => {
  const body = '1234567890abcdef1234567890abcdef12345678';
  assert.equal(normalizeEvmFamilyAddress(`xdc${body}`), `0x${body}`);
  assert.equal(normalizeEvmFamilyAddress(`0x${body}`), `0x${body}`);
});

test('EVM native and ERC20 proofs bind to one verified deployment context and prove exact balance deltas', async () => {
  const deployment = deploymentFor('base:sepolia');
  const nativeBinding = createEvmProofBinding({ networkId: 'base:sepolia', deploymentVerification: deployment, contractAddress: VAULT, kind: 'native-recovery' });
  const erc20Binding = createEvmProofBinding({ networkId: 'base:sepolia', deploymentVerification: deployment, contractAddress: VAULT, kind: 'erc20-recovery', tokenAddress: TOKEN });
  assert.equal(nativeBinding.contextSha256, erc20Binding.contextSha256);

  const state = { balance: 0n, recovered: false, approvals: new Set(), rescue: 7n, tokenVault: 100n, tokenRescue: 5n };
  const driver = {
    async readState() { return { balance: state.balance.toString(), recovered: state.recovered }; },
    async depositNative({ amount }) { state.balance += BigInt(amount); return { txHash: '0xdeposit' }; },
    async approveRecovery({ actor }) { state.approvals.add(actor); return { txHash: `0x${actor}` }; },
    async executeRecovery() { if (state.approvals.size < 2) throw new Error('threshold'); state.recovered = true; state.rescue += state.balance; state.balance = 0n; return { txHash: '0xexecute' }; },
    async readNativeBalance() { return state.rescue.toString(); },
    async readTokenBalance(_token, address) { return address === VAULT ? state.tokenVault.toString() : state.tokenRescue.toString(); },
    async recoverErc20() { if (!state.recovered) throw new Error('not recovered'); state.tokenRescue += state.tokenVault; state.tokenVault = 0n; return { txHash: '0xtoken' }; }
  };
  const native = await runEvmNativeRecoveryProof({ driver, binding: nativeBinding, config: { contractAddress: VAULT, owner: OWNER, contacts: [CONTACT_A, CONTACT_B], threshold: 2, rescueDestination: RESCUE, nativeAmount: '1000' } });
  assert.equal(native.success, true);
  assert.equal(native.rescueBefore, '7');
  assert.equal(native.rescueAfter, '1007');
  assert.equal(native.rescueDelta, '1000');
  assert.equal(native.bindingSha256, nativeBinding.sha256);

  const token = await runEvmErc20RecoveryProof({ driver, binding: erc20Binding, config: { contractAddress: VAULT, tokenAddress: TOKEN, rescueDestination: RESCUE, executor: OWNER } });
  assert.equal(token.success, true);
  assert.equal(token.rescueAfter, '105');
  assert.equal(token.moved, '100');
  assert.equal(token.bindingSha256, erc20Binding.sha256);
});

test('native proof fails closed when deposit delta is false', async () => {
  const state = { balance: 0n, recovered: false, rescue: 0n };
  const driver = {
    async readState() { return { balance: state.balance.toString(), recovered: state.recovered }; },
    async readNativeBalance() { return state.rescue.toString(); },
    async depositNative() { state.balance += 999n; return { txHash: '0xbad' }; },
    async approveRecovery() { return { txHash: '0xa' }; },
    async executeRecovery() { state.recovered = true; return { txHash: '0xe' }; }
  };
  await assert.rejects(() => runEvmNativeRecoveryProof({ driver, config: { contractAddress: VAULT, owner: OWNER, contacts: [CONTACT_A], threshold: 1, rescueDestination: RESCUE, nativeAmount: '1000' } }), /deposit balance delta/);
});

test('ERC20 proof refuses to run before native recovery state is active', async () => {
  const driver = {
    async readState() { return { recovered: false }; },
    async readTokenBalance() { return '100'; },
    async recoverErc20() { return {}; }
  };
  await assert.rejects(() => runEvmErc20RecoveryProof({ driver, config: { contractAddress: VAULT, tokenAddress: TOKEN, rescueDestination: RESCUE, executor: OWNER } }), /already be recovered/);
});

test('compatibility report stays blocked until every network-specific proof exists', () => {
  const network = getNetwork('base:sepolia');
  const deployment = deploymentFor('base:sepolia', 1);
  const nativeBinding = createEvmProofBinding({ networkId: 'base:sepolia', deploymentVerification: deployment, contractAddress: VAULT, kind: 'native-recovery' });
  const erc20Binding = createEvmProofBinding({ networkId: 'base:sepolia', deploymentVerification: deployment, contractAddress: VAULT, kind: 'erc20-recovery', tokenAddress: TOKEN });
  const report = createEvmCompatibilityReport({
    networkId: 'base:sepolia',
    observations: { chainIdHex: network.chainIdHex, rpcRead: true, walletNetworkSwitch: true },
    deploymentVerification: deployment,
    nativeProof: { success: true, networkRef: network.id, chainId: network.chainId, bindingSha256: nativeBinding.sha256, binding: nativeBinding },
    erc20Proof: { success: false, networkRef: network.id, chainId: network.chainId, bindingSha256: erc20Binding.sha256, binding: erc20Binding },
    finality: createFinalityObservation({ policy: DEFAULT_FINALITY_POLICIES.baseSepolia, transactionRef: '0x1', observedAt: '2026-09-28T00:00:00Z', status: 'finalized', evidence: {} })
  });
  assert.equal(report.readyForLiveProofPromotion, false);
  assert.deepEqual(report.missing, ['erc20-recovery', 'finality-evidence']);
  assert.equal(report.checks['proof-context-bound'], true);
});

test('compatibility report rejects successful proofs cross-wired from another EVM network', () => {
  const base = getNetwork('base:sepolia');
  const baseDeployment = deploymentFor('base:sepolia', 1);
  const xdcDeployment = deploymentFor('xdc:apothem', 1);
  const nativeBinding = createEvmProofBinding({ networkId: 'base:sepolia', deploymentVerification: baseDeployment, contractAddress: VAULT, kind: 'native-recovery' });
  const xdcTokenBinding = createEvmProofBinding({ networkId: 'xdc:apothem', deploymentVerification: xdcDeployment, contractAddress: VAULT, kind: 'erc20-recovery', tokenAddress: TOKEN });
  const report = createEvmCompatibilityReport({
    networkId: 'base:sepolia',
    observations: { chainIdHex: base.chainIdHex, rpcRead: true, walletNetworkSwitch: true },
    deploymentVerification: baseDeployment,
    nativeProof: { success: true, networkRef: base.id, chainId: base.chainId, bindingSha256: nativeBinding.sha256, binding: nativeBinding },
    erc20Proof: { success: true, networkRef: 'xdc:apothem', chainId: 'xdc', bindingSha256: xdcTokenBinding.sha256, binding: xdcTokenBinding },
    finality: createFinalityObservation({ policy: DEFAULT_FINALITY_POLICIES.baseSepolia, transactionRef: '0x1', observedAt: '2026-09-28T00:00:00Z', status: 'finalized', evidence: {} })
  });
  assert.equal(report.readyForLiveProofPromotion, false);
  assert.equal(report.checks['proof-context-bound'], false);
  assert.ok(report.missing.includes('proof-context-bound'));
});

test('XDC Apothem proof binding is chain-specific and accepts xdc-prefixed contract addresses', () => {
  const network = getNetwork('xdc:apothem');
  const xdcVault = `xdc${VAULT.slice(2)}`;
  const deployment = deploymentFor('xdc:apothem', 1, xdcVault);
  const binding = createEvmProofBinding({ networkId: 'xdc:apothem', deploymentVerification: deployment, contractAddress: VAULT, kind: 'native-recovery' });
  assert.equal(network.chainIdDecimal, 51);
  assert.equal(network.chainIdHex, '0x33');
  assert.equal(binding.networkRef, 'xdc:apothem');
  assert.equal(binding.contractAddress, VAULT);
});
