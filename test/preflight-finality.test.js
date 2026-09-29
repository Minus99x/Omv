import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreflightResult, digestIntent } from '../src/chains/preflight.js';
import { DEFAULT_FINALITY_POLICIES, createFinalityObservation } from '../src/chains/finality.js';
import { createEvmCompatibilityProbe, evmProbePreflight } from '../src/chains/evm/compatibility-plan.js';

test('preflight binds a deterministic digest to transaction intent', () => {
  const a = digestIntent({ b: 2, a: 1 });
  const b = digestIntent({ a: 1, b: 2 });
  assert.equal(a, b);
  const result = createPreflightResult({ chainId: 'ethereum', networkRef: 'ethereum:sepolia', operation: 'test', status: 'warning', transactionIntent: { to: '0xabc', value: '1' } });
  assert.match(result.intentDigest, /^[a-f0-9]{64}$/);
});

test('rollup finality policy does not collapse L2 inclusion into parent finality', () => {
  assert.equal(DEFAULT_FINALITY_POLICIES.arbitrumSepolia.model, 'rollup');
  assert.equal(DEFAULT_FINALITY_POLICIES.arbitrumSepolia.target.parentFinalityRequiredForProduction, true);
  const observation = createFinalityObservation({ policy: DEFAULT_FINALITY_POLICIES.arbitrumSepolia, transactionRef: '0x1', observedAt: '2026-09-28T00:00:00Z', status: 'included', evidence: { l2BlockNumber: 123 } });
  assert.equal(observation.status, 'included');
});

test('EVM compatibility probe is network-specific and fails wrong chain identity', () => {
  const probe = createEvmCompatibilityProbe('base:sepolia');
  assert.equal(probe.expectedChainIdHex, '0x14a34');
  const preflight = evmProbePreflight({ networkId: 'base:sepolia', observedChainIdHex: '0xaa36a7' });
  assert.equal(preflight.status, 'blocked');
  assert.ok(preflight.errors[0].includes('does not match'));
});
