import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { evidenceDigest } from '../src/core/evidence.js';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';
import { createReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';
import {
  createReviewerTrustPolicyAnchorHistoryEntry,
  createReviewerTrustPolicyAnchorHistorySnapshot,
  verifyCurrentReviewerTrustPolicyAnchor,
  verifyReviewerTrustPolicyAnchorHistory,
  verifyReviewerTrustPolicyAnchorHistorySnapshot
} from '../src/core/reviewer-trust-policy-anchor-history.js';

function reviewIndex(ref, byte) {
  const core = {
    schema:'omegavault.external-review-index.v1',
    checkpoint:{ ref, archiveFilename:`omegavault-mvp-${ref}.zip`, archiveSha256:byte.repeat(64) },
    checkpointManifest:{ logicalSha256:'22'.repeat(32) },
    reviewBasis:{ sha256:'33'.repeat(32) },
    verification:{ sourceAncestryInference:false }
  };
  return { ...core, sha256:evidenceDigest(core) };
}

function fixture() {
  const key = generateKeyPairSync('ed25519');
  const event = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:key.publicKey, action:'enroll', configuredBy:'policy', configuredAt:'2026-10-03T06:00:00Z' });
  const trustHistory = [event];
  const trustHistorySnapshot = createReviewerTrustHistorySnapshot(trustHistory);
  const first = createReviewerTrustPolicyAnchor({ externalReviewIndex:reviewIndex('0.6.44-dev','1'), trustHistory, trustHistorySnapshot, anchoredBy:'registry', anchoredAt:'2026-10-03T06:01:00Z' });
  const second = createReviewerTrustPolicyAnchor({ externalReviewIndex:reviewIndex('0.6.45-dev','2'), trustHistory, trustHistorySnapshot, anchoredBy:'registry', anchoredAt:'2026-10-03T06:02:00Z' });
  const firstEntry = createReviewerTrustPolicyAnchorHistoryEntry({ anchor:first });
  const secondEntry = createReviewerTrustPolicyAnchorHistoryEntry({ anchor:second, previousEntry:firstEntry });
  const history = [firstEntry, secondEntry];
  return { first, second, firstEntry, secondEntry, history, snapshot:createReviewerTrustPolicyAnchorHistorySnapshot(history) };
}

test('policy-anchor history binds every anchor to its exact predecessor and current head', () => {
  const { second, firstEntry, secondEntry, history, snapshot } = fixture();
  assert.equal(secondEntry.sequence, 2);
  assert.equal(secondEntry.previousEntrySha256, firstEntry.sha256);
  assert.equal(secondEntry.previousAnchorSha256, firstEntry.anchorSha256);
  assert.equal(snapshot.headEntrySha256, secondEntry.sha256);
  assert.equal(snapshot.headAnchorSha256, second.sha256);
  assert.equal(verifyReviewerTrustPolicyAnchorHistory(history).ok, true);
  assert.equal(verifyReviewerTrustPolicyAnchorHistorySnapshot(snapshot, history).ok, true);
  assert.equal(verifyCurrentReviewerTrustPolicyAnchor({ anchor:second, history, historySnapshot:snapshot }).ok, true);
});

test('older policy anchor is rejected against the current history head', () => {
  const { first, history, snapshot } = fixture();
  const result = verifyCurrentReviewerTrustPolicyAnchor({ anchor:first, history, historySnapshot:snapshot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /current anchor-history head/i.test(error)));
});

test('valid-prefix rollback, reorder, skipped link, duplicate, and identity change fail closed', () => {
  const { firstEntry, secondEntry, history, snapshot } = fixture();
  const stale = [firstEntry];
  assert.equal(verifyReviewerTrustPolicyAnchorHistorySnapshot(snapshot, stale).ok, false);
  assert.equal(verifyReviewerTrustPolicyAnchorHistory([secondEntry, firstEntry]).ok, false);
  const skipped = structuredClone(secondEntry); skipped.previousEntrySha256 = 'ab'.repeat(32); skipped.sha256 = evidenceDigest(Object.fromEntries(Object.entries(skipped).filter(([key]) => key !== 'sha256')));
  assert.equal(verifyReviewerTrustPolicyAnchorHistory([firstEntry, skipped]).ok, false);
  const duplicate = structuredClone(secondEntry); duplicate.anchorSha256 = firstEntry.anchorSha256; duplicate.sha256 = evidenceDigest(Object.fromEntries(Object.entries(duplicate).filter(([key]) => key !== 'sha256')));
  assert.equal(verifyReviewerTrustPolicyAnchorHistory([firstEntry, duplicate]).ok, false);
  const changed = structuredClone(secondEntry); changed.reviewer = 'other-team'; changed.sha256 = evidenceDigest(Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'sha256')));
  assert.equal(verifyReviewerTrustPolicyAnchorHistory([firstEntry, changed]).ok, false);
  assert.equal(verifyReviewerTrustPolicyAnchorHistory(history).ok, true);
});

test('duplicate and non-increasing policy anchors cannot be appended', () => {
  const { first, firstEntry } = fixture();
  assert.throws(() => createReviewerTrustPolicyAnchorHistoryEntry({ anchor:first, previousEntry:firstEntry }), /same anchor twice/i);
  const changedTime = structuredClone(first); changedTime.anchoredAt = '2026-10-03T06:00:59.000Z'; changedTime.sha256 = evidenceDigest(Object.fromEntries(Object.entries(changedTime).filter(([key]) => key !== 'sha256')));
  assert.throws(() => createReviewerTrustPolicyAnchorHistoryEntry({ anchor:changedTime, previousEntry:firstEntry }), /increase strictly/i);
});
