import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createExternalReviewReceipt, verifyExternalReviewReceipt, createDetachedReviewReceiptSignature, verifyDetachedReviewReceiptSignature } from '../src/core/review-receipt.js';

const reviewIndex = Object.freeze({
  schema: 'omegavault.external-review-index.v1',
  sha256: '11'.repeat(32),
  checkpoint: Object.freeze({ ref: '0.6.40-dev', archiveSha256: '22'.repeat(32) }),
  reviewBasis: Object.freeze({ sha256: '33'.repeat(32) })
});

function receipt(outcome='verified') {
  return createExternalReviewReceipt({ reviewIndex, outcome, reviewer: 'independent-reviewer', reviewedAt: '2026-10-02T23:00:00Z', notes: ['offline verification'] });
}

test('review receipt binds one external review index and has no promotion authority', () => {
  const value = receipt();
  assert.equal(value.reviewIndex.sha256, reviewIndex.sha256);
  assert.equal(value.outcome, 'verified');
  assert.equal(value.signatureStatus, 'unsigned');
  assert.equal(value.authority.chainPromotion, false);
  assert.equal(value.authority.evidencePromotion, false);
  assert.deepEqual(verifyExternalReviewReceipt(value), { ok: true, errors: [] });
});

test('review receipt supports verified-with-notes and rejected outcomes', () => {
  assert.equal(receipt('verified-with-notes').outcome, 'verified-with-notes');
  assert.equal(receipt('rejected').outcome, 'rejected');
  assert.throws(() => receipt('promote'), /Unsupported review outcome/);
});

test('tampering review outcome or promotion authority invalidates receipt', () => {
  const changed = structuredClone(receipt());
  changed.authority.chainPromotion = true;
  const result = verifyExternalReviewReceipt(changed);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /no promotion authority|digest mismatch/i.test(error)));
});

test('real detached Ed25519 signature authenticates the receipt only', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const value = receipt();
  const signature = createDetachedReviewReceiptSignature({ receipt: value, privateKey, publicKey });
  assert.equal(signature.authority.chainPromotion, false);
  assert.equal(signature.authority.scope, 'authenticity-of-review-receipt-only');
  assert.equal(verifyDetachedReviewReceiptSignature(signature, value, publicKey).authenticated, true);
});

test('detached signature fails on wrong key, changed receipt, or missing public key', () => {
  const signer = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const value = receipt();
  const signature = createDetachedReviewReceiptSignature({ receipt: value, privateKey: signer.privateKey, publicKey: signer.publicKey });
  assert.equal(verifyDetachedReviewReceiptSignature(signature, value, other.publicKey).ok, false);
  assert.equal(verifyDetachedReviewReceiptSignature(signature, value, null).ok, false);
  const changed = structuredClone(value); changed.notes = ['changed'];
  assert.equal(verifyDetachedReviewReceiptSignature(signature, changed, signer.publicKey).ok, false);
});
