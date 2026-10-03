import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createDetachedReviewReceiptSignature, createExternalReviewReceipt } from '../src/core/review-receipt.js';
import { assessReviewerTrustHistory, createReviewerTrustEvent, createReviewerTrustHistorySnapshot, verifyReviewerTrustHistory, verifyReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';

const reviewIndex = { schema:'omegavault.external-review-index.v1', sha256:'11'.repeat(32), checkpoint:{ref:'0.6.42-dev',archiveSha256:'22'.repeat(32)}, reviewBasis:{sha256:'33'.repeat(32)} };

function receipt(reviewer = 'audit-team') {
  return createExternalReviewReceipt({ reviewIndex, outcome:'verified', reviewer, reviewedAt:'2026-10-03T04:00:00Z' });
}

function historyFixture() {
  const first = generateKeyPairSync('ed25519');
  const second = generateKeyPairSync('ed25519');
  const enroll = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:first.publicKey, action:'enroll', configuredBy:'review-policy', configuredAt:'2026-10-03T04:01:00Z', reason:'initial reviewer key' });
  const rotate = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:second.publicKey, action:'rotate', configuredBy:'review-policy', configuredAt:'2026-10-03T04:02:00Z', previousEvent:enroll, reason:'scheduled rotation' });
  return { first, second, enroll, rotate };
}

test('reviewer trust history binds enrollment and key rotation in a digest chain', () => {
  const { first, second, enroll, rotate } = historyFixture();
  assert.notEqual(enroll.publicKeySpkiSha256, rotate.publicKeySpkiSha256);
  assert.equal(rotate.previousEventSha256, enroll.sha256);
  assert.equal(rotate.previousPublicKeySpkiSha256, enroll.publicKeySpkiSha256);
  const verification = verifyReviewerTrustHistory([enroll, rotate]);
  assert.equal(verification.ok, true);
  assert.equal(verification.status, 'trusted');
  assert.equal(verification.currentKeySpkiSha256, rotate.publicKeySpkiSha256);
  assert.equal(first.privateKey.type, 'private');
  assert.equal(second.privateKey.type, 'private');
});

test('only the current rotated key can confer reviewer trust', () => {
  const { first, second, enroll, rotate } = historyFixture();
  const value = receipt();
  const oldSignature = createDetachedReviewReceiptSignature({ receipt:value, privateKey:first.privateKey });
  const currentSignature = createDetachedReviewReceiptSignature({ receipt:value, privateKey:second.privateKey });
  const oldResult = assessReviewerTrustHistory({ receipt:value, signature:oldSignature, publicKey:first.publicKey, trustHistory:[enroll, rotate] });
  assert.equal(oldResult.signatureAuthenticated, true);
  assert.equal(oldResult.reviewerTrusted, false);
  assert.equal(oldResult.decision, 'authenticated-untrusted');
  const currentResult = assessReviewerTrustHistory({ receipt:value, signature:currentSignature, publicKey:second.publicKey, trustHistory:[enroll, rotate] });
  assert.equal(currentResult.ok, true);
  assert.equal(currentResult.reviewerTrusted, true);
  assert.equal(currentResult.decision, 'trusted-authenticated');
});

test('revocation is terminal and authenticates without trusting the revoked key', () => {
  const { second, enroll, rotate } = historyFixture();
  const revoke = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:second.publicKey, action:'revoke', configuredBy:'review-policy', configuredAt:'2026-10-03T04:03:00Z', previousEvent:rotate, reason:'reviewer access ended' });
  const verification = verifyReviewerTrustHistory([enroll, rotate, revoke]);
  assert.equal(verification.ok, true);
  assert.equal(verification.status, 'revoked');
  const value = receipt();
  const signature = createDetachedReviewReceiptSignature({ receipt:value, privateKey:second.privateKey });
  const result = assessReviewerTrustHistory({ receipt:value, signature, publicKey:second.publicKey, trustHistory:[enroll, rotate, revoke] });
  assert.equal(result.signatureAuthenticated, true);
  assert.equal(result.reviewerTrusted, false);
  assert.equal(result.trustStatus, 'revoked');
  assert.throws(() => createReviewerTrustEvent({ reviewer:'audit-team', publicKey:second.publicKey, action:'rotate', configuredBy:'review-policy', configuredAt:'2026-10-03T04:04:00Z', previousEvent:revoke }), /follow revocation/);
});

test('tampered, reordered, skipped and cross-reviewer history fails closed', () => {
  const { second, enroll, rotate } = historyFixture();
  assert.equal(verifyReviewerTrustHistory([rotate, enroll]).ok, false);
  assert.equal(verifyReviewerTrustHistory([enroll, { ...rotate, sequence:3 }]).ok, false);
  const tampered = structuredClone(rotate); tampered.previousEventSha256 = 'ff'.repeat(32);
  assert.equal(verifyReviewerTrustHistory([enroll, tampered]).ok, false);
  assert.throws(() => createReviewerTrustEvent({ reviewer:'other-team', publicKey:second.publicKey, action:'revoke', configuredBy:'review-policy', configuredAt:'2026-10-03T04:03:00Z', previousEvent:rotate }), /identity must remain constant/);
});

test('invalid transitions and non-increasing timestamps fail closed', () => {
  const key = generateKeyPairSync('ed25519');
  assert.throws(() => createReviewerTrustEvent({ reviewer:'audit-team', publicKey:key.publicKey, action:'revoke', configuredBy:'review-policy', configuredAt:'2026-10-03T04:00:00Z' }), /first.*enroll/i);
  const enroll = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:key.publicKey, action:'enroll', configuredBy:'review-policy', configuredAt:'2026-10-03T04:01:00Z' });
  assert.throws(() => createReviewerTrustEvent({ reviewer:'audit-team', publicKey:key.publicKey, action:'rotate', configuredBy:'review-policy', configuredAt:'2026-10-03T04:02:00Z', previousEvent:enroll }), /different reviewer key/);
  const second = generateKeyPairSync('ed25519');
  const stale = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:second.publicKey, action:'rotate', configuredBy:'review-policy', configuredAt:'2026-10-03T04:00:00Z', previousEvent:enroll });
  assert.equal(verifyReviewerTrustHistory([enroll, stale]).ok, false);
});

test('history snapshot detects valid-prefix rollback and tampering', () => {
  const { enroll, rotate } = historyFixture();
  const snapshot = createReviewerTrustHistorySnapshot([enroll, rotate]);
  assert.equal(verifyReviewerTrustHistorySnapshot(snapshot, [enroll, rotate]).ok, true);
  assert.equal(verifyReviewerTrustHistorySnapshot(snapshot, [enroll]).ok, false);
  const tampered = structuredClone(snapshot); tampered.eventCount = 1;
  assert.equal(verifyReviewerTrustHistorySnapshot(tampered, [enroll, rotate]).ok, false);
});
