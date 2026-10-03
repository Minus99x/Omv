import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  assessReviewerKeyTrust,
  createDetachedReviewReceiptSignature,
  createExternalReviewReceipt,
  createReviewerKeyTrustMetadata,
  verifyDetachedReviewReceiptSignature,
  verifyExternalReviewReceipt,
  verifyReviewerKeyTrustMetadata
} from '../src/core/review-receipt.js';

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

test('authenticated signature remains untrusted when no reviewer trust is configured', () => {
  const signer = generateKeyPairSync('ed25519');
  const value = receipt();
  const signature = createDetachedReviewReceiptSignature({ receipt: value, privateKey: signer.privateKey });
  const result = assessReviewerKeyTrust({ receipt: value, signature, publicKey: signer.publicKey });
  assert.equal(result.ok, true);
  assert.equal(result.signatureAuthenticated, true);
  assert.equal(result.trustConfigured, false);
  assert.equal(result.reviewerTrusted, false);
  assert.equal(result.decision, 'authenticated-untrusted');
});

test('separately configured matching reviewer key can be trusted without promotion authority', () => {
  const signer = generateKeyPairSync('ed25519');
  const value = receipt();
  const signature = createDetachedReviewReceiptSignature({ receipt: value, privateKey: signer.privateKey });
  const trust = createReviewerKeyTrustMetadata({
    reviewer: value.reviewer,
    publicKey: signer.publicKey,
    status: 'trusted',
    configuredBy: 'omegavault-review-policy',
    configuredAt: '2026-10-03T02:00:00Z'
  });
  assert.equal(trust.authority.chainPromotion, false);
  assert.equal(verifyReviewerKeyTrustMetadata(trust).ok, true);
  const result = assessReviewerKeyTrust({ receipt: value, signature, publicKey: signer.publicKey, trustMetadata: trust });
  assert.equal(result.signatureAuthenticated, true);
  assert.equal(result.reviewerIdentityMatched, true);
  assert.equal(result.reviewerTrusted, true);
  assert.equal(result.decision, 'trusted-authenticated');
});

test('revoked, identity-mismatched and tampered trust metadata never confers reviewer trust', () => {
  const signer = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const value = receipt();
  const signature = createDetachedReviewReceiptSignature({ receipt: value, privateKey: signer.privateKey });
  const base = createReviewerKeyTrustMetadata({ reviewer: value.reviewer, publicKey: signer.publicKey, status: 'revoked', configuredBy: 'omegavault-review-policy', configuredAt: '2026-10-03T02:00:00Z' });
  assert.equal(assessReviewerKeyTrust({ receipt: value, signature, publicKey: signer.publicKey, trustMetadata: base }).reviewerTrusted, false);
  const wrongIdentity = createReviewerKeyTrustMetadata({ reviewer: 'different-reviewer', publicKey: signer.publicKey, status: 'trusted', configuredBy: 'omegavault-review-policy', configuredAt: '2026-10-03T02:00:00Z' });
  const mismatch = assessReviewerKeyTrust({ receipt: value, signature, publicKey: signer.publicKey, trustMetadata: wrongIdentity });
  assert.equal(mismatch.reviewerTrusted, false);
  assert.equal(mismatch.ok, false);
  const wrongKey = createReviewerKeyTrustMetadata({ reviewer: value.reviewer, publicKey: other.publicKey, status: 'trusted', configuredBy: 'omegavault-review-policy', configuredAt: '2026-10-03T02:00:00Z' });
  const wrongKeyResult = assessReviewerKeyTrust({ receipt: value, signature, publicKey: signer.publicKey, trustMetadata: wrongKey });
  assert.equal(wrongKeyResult.reviewerTrusted, false);
  assert.equal(wrongKeyResult.ok, false);
  const tampered = structuredClone(base); tampered.authority.chainPromotion = true;
  assert.equal(verifyReviewerKeyTrustMetadata(tampered).ok, false);
  assert.equal(assessReviewerKeyTrust({ receipt: value, signature, publicKey: signer.publicKey, trustMetadata: tampered }).reviewerTrusted, false);
});
