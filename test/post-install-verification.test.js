import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostInstallVerificationPlan } from '../src/core/post-install-verification.js';

function report(overrides = {}) {
  return {
    dependencyLock: { ok: true },
    missingPackages: [],
    mismatchedPackages: [],
    readyForPinnedNodeSuites: true,
    ...overrides
  };
}

test('post-install verification plan is offline-only and runs Stellar plus Bitcoin suites', () => {
  const plan = createPostInstallVerificationPlan(report());
  assert.equal(plan.ready, true);
  assert.equal(plan.liveChainActions, false);
  assert.deepEqual(plan.suites.map(suite => suite.id), ['stellar-native-recovery', 'bitcoin-cryptographic-finalizer']);
});

test('post-install verification plan recommends npm ci when pinned packages are missing', () => {
  const plan = createPostInstallVerificationPlan(report({ missingPackages: ['@stellar/stellar-sdk'], readyForPinnedNodeSuites: false }));
  assert.equal(plan.ready, false);
  assert.equal(plan.recommendedRepair, 'npm ci');
});

test('post-install verification plan fails closed on version mismatch', () => {
  const plan = createPostInstallVerificationPlan(report({ mismatchedPackages: [{ name: '@noble/curves', expected: '2.4.0', installed: '2.4.1' }], readyForPinnedNodeSuites: false }));
  assert.equal(plan.ready, false);
  assert.equal(plan.recommendedRepair, 'npm ci');
});

test('post-install verification plan refuses npm ci recommendation if the lock itself is invalid', () => {
  const plan = createPostInstallVerificationPlan(report({ dependencyLock: { ok: false }, readyForPinnedNodeSuites: false }));
  assert.equal(plan.ready, false);
  assert.match(plan.recommendedRepair, /repair package/);
});
