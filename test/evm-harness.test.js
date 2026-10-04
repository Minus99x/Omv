import test from 'node:test';
import assert from 'node:assert/strict';
import { getNetwork } from '../src/chains/network-registry.js';
import { createDeploymentVerificationReport, runtimeCodeMatches } from '../src/chains/evm/deployment-verification.js';
import { createEvmCompatibilityReport } from '../src/chains/evm/compatibility-report.js';
import { runEvmNativeRecoveryProof, runEvmErc20RecoveryProof } from '../src/chains/evm/recovery-test-runner.js';
import { createFinalityObservation, DEFAULT_FINALITY_POLICIES } from '../src/chains/finality.js';

test('deterministic EVM deployment verifier masks immutable ranges and checks policy config', () => {
  assert.equal(runtimeCodeMatches('0x6001aabb6002', '0x6001ccdd6002', { x: [{ start: 2, length: 2 }] }), true);
  const network = getNetwork('base:sepolia');
  const expected = { owner: '0x0000000000000000000000000000000000000001', rescueDestination: '0x0000000000000000000000000000000000000002', threshold: 2, inactivitySeconds: 60, adapterVersion: 500, trustedContacts: ['0x0000000000000000000000000000000000000003', '0x0000000000000000000000000000000000000004'] };
  const report = createDeploymentVerificationReport({ network, compiledRuntimeBytecode: '0x6001aabb6002', liveRuntimeBytecode: '0x6001ccdd6002', immutableReferences: { x: [{ start: 2, length: 2 }] }, expected, observed: { ...expected, chainIdHex: network.chainIdHex, deploymentTxRef: '0xdeploy' }, sourceSha256: 'abc', observedAt: '2026-09-28T00:00:00Z' });
  assert.equal(report.verified, true);
  assert.match(report.sha256, /^[a-f0-9]{64}$/);
});

test('EVM native and ERC20 proof runners can execute against a custody-free driver', async () => {
  const state = { balance: 0n, recovered: false, approvals: new Set(), rescue: 0n, tokenVault: 100n, tokenRescue: 5n };
  const driver = {
    async readState() { return { balance: state.balance.toString(), recovered: state.recovered }; },
    async depositNative({ amount }) { state.balance += BigInt(amount); return { txHash: '0xdeposit' }; },
    async approveRecovery({ actor }) { state.approvals.add(actor); return { txHash: `0x${actor}` }; },
    async executeRecovery() { if (state.approvals.size < 2) throw new Error('threshold'); state.recovered = true; state.rescue += state.balance; state.balance = 0n; return { txHash: '0xexecute' }; },
    async readNativeBalance() { return state.rescue.toString(); },
    async readTokenBalance(_token, address) { return address === 'vault' ? state.tokenVault.toString() : state.tokenRescue.toString(); },
    async recoverErc20() { if (!state.recovered) throw new Error('not recovered'); state.tokenRescue += state.tokenVault; state.tokenVault = 0n; return { txHash: '0xtoken' }; }
  };
  const native = await runEvmNativeRecoveryProof({ driver, config: { contractAddress: 'vault', owner: 'owner', contacts: ['a','b'], threshold: 2, rescueDestination: 'rescue', nativeAmount: '1000' } });
  assert.equal(native.success, true);
  assert.equal(native.rescueBefore, '0');
  assert.equal(native.rescueAfter, '1000');
  assert.equal(native.rescueBalance, '1000');
  assert.equal(native.rescueDeltaMatches, true);
  const token = await runEvmErc20RecoveryProof({ driver, config: { contractAddress: 'vault', tokenAddress: 'token', rescueDestination: 'rescue', executor: 'owner' } });
  assert.equal(token.success, true);
  assert.equal(token.rescueAfter, '105');
});

test('compatibility report stays blocked until every network-specific proof exists', () => {
  const network = getNetwork('base:sepolia');
  const expected = { owner: '0x0000000000000000000000000000000000000001', rescueDestination: '0x0000000000000000000000000000000000000002', threshold: 1, inactivitySeconds: 60, adapterVersion: 500, trustedContacts: ['0x0000000000000000000000000000000000000003'] };
  const deployment = createDeploymentVerificationReport({ network, compiledRuntimeBytecode: '0x6000', liveRuntimeBytecode: '0x6000', expected, observed: { ...expected, chainIdHex: network.chainIdHex, deploymentTxRef: '0xdeploy' }, observedAt: '2026-09-28T00:00:00Z' });
  const report = createEvmCompatibilityReport({ networkId: 'base:sepolia', observations: { chainIdHex: network.chainIdHex, rpcRead: true, walletNetworkSwitch: true }, deploymentVerification: deployment, nativeProof: { success: true }, erc20Proof: { success: false }, finality: createFinalityObservation({ policy: DEFAULT_FINALITY_POLICIES.baseSepolia, transactionRef: '0x1', observedAt: '2026-09-28T00:00:00Z', status: 'finalized', evidence: {} }) });
  assert.equal(report.readyForLiveProofPromotion, false);
  assert.deepEqual(report.missing, ['erc20-recovery']);
});


test('EVM native proof runner rejects unreachable or duplicate approval policy before driver use', async () => {
  const calls = [];
  const driver = {
    async readState() { calls.push('readState'); return { balance:'0', recovered:false }; },
    async depositNative() { calls.push('depositNative'); },
    async approveRecovery() { calls.push('approveRecovery'); },
    async executeRecovery() { calls.push('executeRecovery'); }
  };
  await assert.rejects(
    () => runEvmNativeRecoveryProof({
      driver,
      config:{ contractAddress:'vault', owner:'owner', contacts:['a'], threshold:2, rescueDestination:'rescue', nativeAmount:'1' }
    }),
    /threshold must be reachable/i
  );
  await assert.rejects(
    () => runEvmNativeRecoveryProof({
      driver,
      config:{ contractAddress:'vault', owner:'owner', contacts:['a','a'], threshold:1, rescueDestination:'rescue', nativeAmount:'1' }
    }),
    /contacts must be unique/i
  );
  assert.equal(calls.length, 0);
});

test('EVM native proof runner fails success when rescue delta does not match deposited value', async () => {
  let stateRead = 0;
  let rescueRead = 0;
  const driver = {
    async readState() {
      stateRead += 1;
      return stateRead === 1 ? { balance:'0', recovered:false } : { balance:'0', recovered:true };
    },
    async depositNative() { return { txHash:'0xdeposit' }; },
    async approveRecovery() { return { txHash:'0xapprove' }; },
    async executeRecovery() { return { txHash:'0xexecute' }; },
    async readNativeBalance() {
      rescueRead += 1;
      return rescueRead === 1 ? '5' : '104';
    }
  };
  const result = await runEvmNativeRecoveryProof({
    driver,
    config:{ contractAddress:'vault', owner:'owner', contacts:['a'], threshold:1, rescueDestination:'rescue', nativeAmount:'100' }
  });
  assert.equal(result.rescueDeltaMatches, false);
  assert.equal(result.success, false);
});
