import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionPlan, requiresExternalFeePayer } from '../src/core/action-plan.js';

test('self-funded action keeps authorizer and fee payer together', () => {
  const signer = '0xabc';
  const plan = createActionPlan({ chainId: 'ethereum', networkRef: '0xaa36a7', operation: 'recovery.approve', requiredSigner: signer });
  assert.equal(plan.requiredSigner, signer);
  assert.equal(plan.feePayer, signer);
  assert.equal(requiresExternalFeePayer(plan), false);
});

test('relayer plan can separate signer from fee payer', () => {
  const plan = createActionPlan({
    chainId: 'ethereum', networkRef: '0xaa36a7', operation: 'recovery.approve',
    requiredSigner: 'contact-a', feePayer: 'relayer-1', sponsorMode: 'relayer'
  });
  assert.equal(requiresExternalFeePayer(plan), true);
});

test('self-funded action rejects a different fee payer', () => {
  assert.throws(() => createActionPlan({
    chainId: 'ethereum', networkRef: '0xaa36a7', operation: 'recovery.approve',
    requiredSigner: 'contact-a', feePayer: 'owner', sponsorMode: 'self-funded'
  }), /Self-funded/);
});
