import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { evidenceDigest } from '../src/core/evidence.js';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';
import { createReviewerTrustPolicyAnchor, verifyReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';

function reviewIndex(ref = '0.6.43-dev') {
  const core = { schema:'omegavault.external-review-index.v1', checkpoint:{ ref, archiveFilename:`omegavault-mvp-${ref}.zip`, archiveSha256:'11'.repeat(32) }, checkpointManifest:{ filename:'checkpoint.json', fileSha256:'22'.repeat(32), logicalSha256:'33'.repeat(32), sourceTreeSha256:'44'.repeat(32), dependencyLockSha256:'55'.repeat(32) }, reviewBasis:{ schema:'omegavault.external-review-basis.v1', sha256:'66'.repeat(32) }, verification:{ sourceAncestryInference:false } };
  return { ...core, sha256:evidenceDigest(core) };
}

function trustPolicy() {
  const key = generateKeyPairSync('ed25519');
  const event = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:key.publicKey, action:'enroll', configuredBy:'review-policy', configuredAt:'2026-10-03T06:00:00Z' });
  const history = [event];
  return { history, snapshot:createReviewerTrustHistorySnapshot(history) };
}

test('trust-policy anchor binds exact external review index and history snapshot', () => {
  const externalReviewIndex = reviewIndex();
  const { history, snapshot } = trustPolicy();
  const anchor = createReviewerTrustPolicyAnchor({ externalReviewIndex, trustHistory:history, trustHistorySnapshot:snapshot, anchoredBy:'independent-policy-registry', anchoredAt:'2026-10-03T06:01:00Z' });
  assert.equal(anchor.externalReviewIndex.sha256, externalReviewIndex.sha256);
  assert.equal(anchor.trustPolicy.snapshotSha256, snapshot.sha256);
  assert.equal(anchor.authority.chainPromotion, false);
  assert.equal(verifyReviewerTrustPolicyAnchor(anchor, { externalReviewIndex, trustHistory:history, trustHistorySnapshot:snapshot, anchoredBy:anchor.anchoredBy, anchoredAt:anchor.anchoredAt }).ok, true);
});

test('stale history and matching stale snapshot fail against current anchor', () => {
  const externalReviewIndex = reviewIndex();
  const first = generateKeyPairSync('ed25519');
  const second = generateKeyPairSync('ed25519');
  const enroll = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:first.publicKey, action:'enroll', configuredBy:'review-policy', configuredAt:'2026-10-03T06:00:00Z' });
  const rotate = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:second.publicKey, action:'rotate', configuredBy:'review-policy', configuredAt:'2026-10-03T06:01:00Z', previousEvent:enroll });
  const currentHistory = [enroll, rotate];
  const currentSnapshot = createReviewerTrustHistorySnapshot(currentHistory);
  const anchor = createReviewerTrustPolicyAnchor({ externalReviewIndex, trustHistory:currentHistory, trustHistorySnapshot:currentSnapshot, anchoredBy:'independent-policy-registry', anchoredAt:'2026-10-03T06:02:00Z' });
  const staleHistory = [enroll];
  const staleSnapshot = createReviewerTrustHistorySnapshot(staleHistory);
  const result = verifyReviewerTrustPolicyAnchor(anchor, { externalReviewIndex, trustHistory:staleHistory, trustHistorySnapshot:staleSnapshot, anchoredBy:anchor.anchoredBy, anchoredAt:anchor.anchoredAt });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /anchor|snapshot/i.test(error)));
});

test('cross-checkpoint review index and tampered anchor fail closed', () => {
  const externalReviewIndex = reviewIndex();
  const { history, snapshot } = trustPolicy();
  const anchor = createReviewerTrustPolicyAnchor({ externalReviewIndex, trustHistory:history, trustHistorySnapshot:snapshot, anchoredBy:'independent-policy-registry', anchoredAt:'2026-10-03T06:01:00Z' });
  assert.equal(verifyReviewerTrustPolicyAnchor(anchor, { externalReviewIndex:reviewIndex('0.6.44-dev'), trustHistory:history, trustHistorySnapshot:snapshot, anchoredBy:anchor.anchoredBy, anchoredAt:anchor.anchoredAt }).ok, false);
  const tampered = structuredClone(anchor); tampered.authority.chainPromotion = true;
  assert.equal(verifyReviewerTrustPolicyAnchor(tampered, { externalReviewIndex, trustHistory:history, trustHistorySnapshot:snapshot, anchoredBy:anchor.anchoredBy, anchoredAt:anchor.anchoredAt }).ok, false);
});

