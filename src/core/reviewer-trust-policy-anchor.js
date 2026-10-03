import { evidenceDigest } from './evidence.js';
import { verifyReviewerTrustHistorySnapshot } from './reviewer-trust-history.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function text(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = text(value, label);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO-compatible timestamp.`);
  return new Date(time).toISOString();
}

function verifyReviewIndexDigest(reviewIndex) {
  if (!reviewIndex || typeof reviewIndex !== 'object' || Array.isArray(reviewIndex)) throw new TypeError('externalReviewIndex must be an object.');
  if (reviewIndex.schema !== 'omegavault.external-review-index.v1') throw new TypeError('externalReviewIndex must use omegavault.external-review-index.v1.');
  if (typeof reviewIndex.sha256 !== 'string' || !SHA256.test(reviewIndex.sha256)) throw new TypeError('externalReviewIndex.sha256 must be a SHA-256 hex digest.');
  const { sha256, ...unsigned } = reviewIndex;
  if (evidenceDigest(unsigned) !== sha256) throw new Error('External review-index digest mismatch.');
  return reviewIndex;
}

export function createReviewerTrustPolicyAnchor({ externalReviewIndex, trustHistory, trustHistorySnapshot, anchoredBy, anchoredAt }) {
  const reviewIndex = verifyReviewIndexDigest(externalReviewIndex);
  const snapshotVerification = verifyReviewerTrustHistorySnapshot(trustHistorySnapshot, trustHistory);
  if (!snapshotVerification.ok) throw new Error(`Reviewer trust-policy snapshot is invalid: ${snapshotVerification.errors.join('; ')}`);
  const core = Object.freeze({
    schema: 'omegavault.reviewer-trust-policy-anchor.v1',
    externalReviewIndex: Object.freeze({
      sha256: reviewIndex.sha256,
      checkpointRef: text(reviewIndex.checkpoint?.ref, 'externalReviewIndex.checkpoint.ref'),
      archiveSha256: text(reviewIndex.checkpoint?.archiveSha256, 'externalReviewIndex.checkpoint.archiveSha256')
    }),
    trustPolicy: Object.freeze({
      reviewer: trustHistorySnapshot.reviewer,
      snapshotSha256: trustHistorySnapshot.sha256,
      eventCount: trustHistorySnapshot.eventCount,
      headSha256: trustHistorySnapshot.headSha256,
      currentKeySpkiSha256: trustHistorySnapshot.currentKeySpkiSha256,
      status: trustHistorySnapshot.status
    }),
    anchoredBy: text(anchoredBy, 'anchoredBy'),
    anchoredAt: timestamp(anchoredAt, 'anchoredAt'),
    authority: Object.freeze({
      chainPromotion: false,
      evidencePromotion: false,
      scope: 'reviewer-trust-policy-integrity-only'
    })
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyReviewerTrustPolicyAnchor(anchor, inputs) {
  const errors = [];
  let expected;
  try { expected = createReviewerTrustPolicyAnchor(inputs); }
  catch (error) { return Object.freeze({ ok:false, errors:Object.freeze([error.message]) }); }
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return Object.freeze({ ok:false, errors:Object.freeze(['Reviewer trust-policy anchor must be an object.']) });
  if (anchor.schema !== expected.schema) errors.push('Unexpected reviewer trust-policy anchor schema.');
  if (anchor.sha256 !== expected.sha256) errors.push('Reviewer trust-policy anchor digest mismatch.');
  if (evidenceDigest(anchor.externalReviewIndex ?? null) !== evidenceDigest(expected.externalReviewIndex)) errors.push('External review-index anchor mismatch.');
  if (evidenceDigest(anchor.trustPolicy ?? null) !== evidenceDigest(expected.trustPolicy)) errors.push('Reviewer trust-policy snapshot anchor mismatch.');
  if (anchor.anchoredBy !== expected.anchoredBy || anchor.anchoredAt !== expected.anchoredAt) errors.push('Reviewer trust-policy anchoring provenance mismatch.');
  if (anchor.authority?.chainPromotion !== false || anchor.authority?.evidencePromotion !== false || anchor.authority?.scope !== 'reviewer-trust-policy-integrity-only') errors.push('Reviewer trust-policy anchor must have no promotion authority.');
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

