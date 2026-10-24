import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeeEvidence, reconcileFeeEvidence } from '../src/chains/fees.js';
import { definePublicStateCheck, verifyPublicState, createStateSnapshot, compareIndependentStateSnapshots } from '../src/chains/public-state.js';
import { createRecoverySimulation, runRecoverySimulation, RECOVERY_SIMULATION_FIXTURES } from '../src/sim/recovery-simulator.js';

test('fee evidence records estimates, actuals and reconciliation without floating point', () => {
  const estimate = createFeeEvidence({ chainId: 'ethereum', networkRef: 'ethereum:sepolia', status: 'estimate', feePayer: '0xabc', feeAsset: 'native:ETH', total: 1000n, components: { execution: 1000 } });
  const actual = createFeeEvidence({ chainId: 'ethereum', networkRef: 'ethereum:sepolia', status: 'observed', feePayer: '0xabc', feeAsset: 'native:ETH', total: '900', transactionRef: '0xtx', observedAt: '2026-09-28T00:00:00Z' });
  const result = reconcileFeeEvidence(estimate, actual);
  assert.equal(result.delta, '-100');
  assert.equal(result.exceededEstimate, false);
});

test('public-state verification is deterministic and can compare independent sources', () => {
  const checks = [
    definePublicStateCheck({ id: 'recovered', description: 'recovery flag', expected: true }),
    definePublicStateCheck({ id: 'balance', description: 'vault balance', expected: '0' })
  ];
  const verified = verifyPublicState({ chainId: 'ethereum', networkRef: 'ethereum:sepolia', mechanismRef: '0xvault', observedAt: '2026-09-28T00:00:00Z', source: 'rpc-a', checks, observations: { recovered: true, balance: '0' } });
  assert.equal(verified.verified, true);
  assert.match(verified.sha256, /^[a-f0-9]{64}$/);
  const a = createStateSnapshot({ chainId: 'ethereum', networkRef: 'ethereum:sepolia', mechanismRef: '0xvault', observedAt: '2026-09-28T00:00:00Z', source: 'rpc-a', observations: { recovered: true, balance: '0' } });
  const b = createStateSnapshot({ chainId: 'ethereum', networkRef: 'ethereum:sepolia', mechanismRef: '0xvault', observedAt: '2026-09-28T00:00:02Z', source: 'indexer-b', observations: { recovered: true, balance: '0' } });
  const comparison = compareIndependentStateSnapshots(a, b, ['recovered', 'balance']);
  assert.equal(comparison.independent, false);
  assert.equal(comparison.distinctSourceLabels, true);
  assert.equal(comparison.matches, true);
});

test('shared recovery simulator proves threshold, duplicate prevention and heartbeat reset', () => {
  const sim = createRecoverySimulation({ owner: 'owner', contacts: ['contact-a', 'contact-b'], threshold: 2, inactivitySeconds: 60, rescueDestination: 'rescue' });
  const happy = runRecoverySimulation(sim, RECOVERY_SIMULATION_FIXTURES.happyPath);
  assert.equal(happy.finalState.recovered, true);
  assert.equal(happy.finalState.balance, '0');
  assert.equal(happy.finalState.rescued, '1000');

  const duplicate = runRecoverySimulation(sim, RECOVERY_SIMULATION_FIXTURES.duplicateApproval);
  assert.deepEqual(duplicate.finalState.approvals, ['contact-a']);

  const reset = runRecoverySimulation(sim, RECOVERY_SIMULATION_FIXTURES.heartbeatReset);
  assert.equal(reset.finalState.recovered, false);
  assert.deepEqual(reset.finalState.approvals, []);
  assert.equal(reset.events.at(-1).error, 'InactivityNotElapsed');
});
