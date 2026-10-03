import { evidenceDigest } from './evidence.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function validDigest(value) { return typeof value === 'string' && SHA256.test(value); }

function verifyAnchorSelf(anchor) {
  const errors = [];
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return Object.freeze({ ok:false, errors:Object.freeze(['Policy anchor must be an object.']) });
  if (anchor.schema !== 'omegavault.reviewer-trust-policy-anchor.v1') errors.push('Unexpected policy-anchor schema.');
  if (!validDigest(anchor.sha256)) errors.push('Policy-anchor SHA-256 is invalid.');
  else { const { sha256, ...unsigned } = anchor; if (evidenceDigest(unsigned) !== sha256) errors.push('Policy-anchor digest mismatch.'); }
  if (!validDigest(anchor.externalReviewIndex?.sha256)) errors.push('Policy-anchor review-index digest is invalid.');
  if (!validDigest(anchor.externalReviewIndex?.archiveSha256)) errors.push('Policy-anchor archive digest is invalid.');
  if (!validDigest(anchor.trustPolicy?.snapshotSha256)) errors.push('Policy-anchor trust snapshot digest is invalid.');
  if (!validDigest(anchor.trustPolicy?.headSha256)) errors.push('Policy-anchor trust-history head digest is invalid.');
  if (!validDigest(anchor.trustPolicy?.currentKeySpkiSha256)) errors.push('Policy-anchor current-key digest is invalid.');
  if (!Number.isSafeInteger(anchor.trustPolicy?.eventCount) || anchor.trustPolicy.eventCount < 1) errors.push('Policy-anchor trust event count is invalid.');
  if (!['trusted','revoked'].includes(anchor.trustPolicy?.status)) errors.push('Policy-anchor trust status is invalid.');
  if (typeof anchor.trustPolicy?.reviewer !== 'string' || !anchor.trustPolicy.reviewer.trim()) errors.push('Policy-anchor reviewer is required.');
  if (typeof anchor.externalReviewIndex?.checkpointRef !== 'string' || !anchor.externalReviewIndex.checkpointRef.trim()) errors.push('Policy-anchor checkpoint reference is required.');
  if (typeof anchor.anchoredBy !== 'string' || !anchor.anchoredBy.trim()) errors.push('Policy-anchor anchoring authority label is required.');
  if (typeof anchor.anchoredAt !== 'string' || !Number.isFinite(Date.parse(anchor.anchoredAt)) || new Date(anchor.anchoredAt).toISOString() !== anchor.anchoredAt) errors.push('Policy-anchor timestamp must be canonical ISO.');
  if (anchor.authority?.chainPromotion !== false || anchor.authority?.evidencePromotion !== false || anchor.authority?.scope !== 'reviewer-trust-policy-integrity-only') errors.push('Policy anchor must have no promotion authority.');
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function createReviewerTrustPolicyAnchorHistoryEntry({ anchor, previousEntry = null }) {
  const anchorVerification = verifyAnchorSelf(anchor);
  if (!anchorVerification.ok) throw new Error(`Cannot record invalid policy anchor: ${anchorVerification.errors.join('; ')}`);
  if (previousEntry) {
    const previousVerification = verifyReviewerTrustPolicyAnchorHistoryEntry(previousEntry);
    if (!previousVerification.ok) throw new Error(`Previous anchor-history entry is invalid: ${previousVerification.errors.join('; ')}`);
    if (previousEntry.reviewer !== anchor.trustPolicy.reviewer) throw new Error('Reviewer identity must remain constant across policy-anchor history.');
    if (previousEntry.anchorSha256 === anchor.sha256) throw new Error('Policy-anchor history cannot record the same anchor twice.');
    if (Date.parse(anchor.anchoredAt) <= Date.parse(previousEntry.recordedAt)) throw new Error('Policy-anchor timestamp must increase strictly.');
  }
  const core = Object.freeze({
    schema:'omegavault.reviewer-trust-policy-anchor-history-entry.v1',
    sequence:previousEntry ? previousEntry.sequence + 1 : 1,
    reviewer:anchor.trustPolicy.reviewer,
    anchorSha256:anchor.sha256,
    externalReviewIndexSha256:anchor.externalReviewIndex.sha256,
    checkpointRef:anchor.externalReviewIndex.checkpointRef,
    trustPolicySnapshotSha256:anchor.trustPolicy.snapshotSha256,
    previousEntrySha256:previousEntry?.sha256 ?? null,
    previousAnchorSha256:previousEntry?.anchorSha256 ?? null,
    recordedAt:anchor.anchoredAt,
    authority:Object.freeze({ chainPromotion:false, evidencePromotion:false, scope:'reviewer-trust-policy-anchor-history-only' })
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyReviewerTrustPolicyAnchorHistoryEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return Object.freeze({ ok:false, errors:Object.freeze(['Policy-anchor history entry must be an object.']) });
  if (entry.schema !== 'omegavault.reviewer-trust-policy-anchor-history-entry.v1') errors.push('Unexpected policy-anchor history-entry schema.');
  if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 1) errors.push('Policy-anchor history sequence must be a positive safe integer.');
  if (typeof entry.reviewer !== 'string' || !entry.reviewer.trim()) errors.push('Policy-anchor history reviewer is required.');
  for (const [field,label] of [['anchorSha256','anchor'],['externalReviewIndexSha256','review index'],['trustPolicySnapshotSha256','trust snapshot']]) if (!validDigest(entry[field])) errors.push(`Policy-anchor history ${label} digest is invalid.`);
  if (entry.previousEntrySha256 !== null && !validDigest(entry.previousEntrySha256)) errors.push('Previous policy-anchor history entry digest is invalid.');
  if (entry.previousAnchorSha256 !== null && !validDigest(entry.previousAnchorSha256)) errors.push('Previous policy-anchor digest is invalid.');
  if (typeof entry.checkpointRef !== 'string' || !entry.checkpointRef.trim()) errors.push('Policy-anchor history checkpoint reference is required.');
  if (typeof entry.recordedAt !== 'string' || !Number.isFinite(Date.parse(entry.recordedAt)) || new Date(entry.recordedAt).toISOString() !== entry.recordedAt) errors.push('Policy-anchor history timestamp must be canonical ISO.');
  if (entry.authority?.chainPromotion !== false || entry.authority?.evidencePromotion !== false || entry.authority?.scope !== 'reviewer-trust-policy-anchor-history-only') errors.push('Policy-anchor history entry must have no promotion authority.');
  if (!validDigest(entry.sha256)) errors.push('Policy-anchor history-entry SHA-256 is invalid.');
  else { const { sha256, ...unsigned } = entry; if (evidenceDigest(unsigned) !== sha256) errors.push('Policy-anchor history-entry digest mismatch.'); }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function verifyReviewerTrustPolicyAnchorHistory(history) {
  const errors = [];
  if (!Array.isArray(history) || history.length === 0) return Object.freeze({ ok:false, errors:Object.freeze(['Policy-anchor history must be a non-empty array.']), head:null });
  const anchors = new Set();
  let previous = null;
  for (const [index,entry] of history.entries()) {
    const verification = verifyReviewerTrustPolicyAnchorHistoryEntry(entry);
    errors.push(...verification.errors.map(error=>`Entry ${index + 1}: ${error}`));
    if (entry?.sequence !== index + 1) errors.push(`Entry ${index + 1}: sequence is not contiguous.`);
    if (anchors.has(entry?.anchorSha256)) errors.push(`Entry ${index + 1}: duplicate policy anchor.`);
    anchors.add(entry?.anchorSha256);
    if (index === 0) {
      if (entry?.previousEntrySha256 !== null || entry?.previousAnchorSha256 !== null) errors.push('Entry 1: initial entry must not reference a predecessor.');
    } else {
      if (entry?.reviewer !== previous?.reviewer) errors.push(`Entry ${index + 1}: reviewer identity changed.`);
      if (entry?.previousEntrySha256 !== previous?.sha256) errors.push(`Entry ${index + 1}: previous entry digest mismatch.`);
      if (entry?.previousAnchorSha256 !== previous?.anchorSha256) errors.push(`Entry ${index + 1}: previous anchor digest mismatch.`);
      if (Number.isFinite(Date.parse(entry?.recordedAt)) && Number.isFinite(Date.parse(previous?.recordedAt)) && Date.parse(entry.recordedAt) <= Date.parse(previous.recordedAt)) errors.push(`Entry ${index + 1}: timestamp must increase strictly.`);
    }
    previous = entry;
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors), head:errors.length === 0 ? previous : null });
}

export function createReviewerTrustPolicyAnchorHistorySnapshot(history) {
  const verification = verifyReviewerTrustPolicyAnchorHistory(history);
  if (!verification.ok) throw new Error(`Cannot snapshot invalid policy-anchor history: ${verification.errors.join('; ')}`);
  const head = verification.head;
  const core = Object.freeze({
    schema:'omegavault.reviewer-trust-policy-anchor-history-snapshot.v1', reviewer:head.reviewer,
    entryCount:history.length, headEntrySha256:head.sha256, headAnchorSha256:head.anchorSha256,
    currentCheckpointRef:head.checkpointRef, currentTrustPolicySnapshotSha256:head.trustPolicySnapshotSha256,
    authority:Object.freeze({ chainPromotion:false, evidencePromotion:false, scope:'reviewer-trust-policy-anchor-history-integrity-only' })
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyReviewerTrustPolicyAnchorHistorySnapshot(snapshot, history) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return Object.freeze({ ok:false, errors:Object.freeze(['Policy-anchor history snapshot must be an object.']) });
  if (snapshot.schema !== 'omegavault.reviewer-trust-policy-anchor-history-snapshot.v1') errors.push('Unexpected policy-anchor history snapshot schema.');
  if (!validDigest(snapshot.sha256)) errors.push('Policy-anchor history snapshot SHA-256 is invalid.');
  else { const { sha256, ...unsigned } = snapshot; if (evidenceDigest(unsigned) !== sha256) errors.push('Policy-anchor history snapshot digest mismatch.'); }
  if (snapshot.authority?.chainPromotion !== false || snapshot.authority?.evidencePromotion !== false || snapshot.authority?.scope !== 'reviewer-trust-policy-anchor-history-integrity-only') errors.push('Policy-anchor history snapshot must have no promotion authority.');
  const verification = verifyReviewerTrustPolicyAnchorHistory(history);
  errors.push(...verification.errors.map(error=>`History: ${error}`));
  if (verification.ok) {
    const expected = createReviewerTrustPolicyAnchorHistorySnapshot(history);
    for (const field of ['reviewer','entryCount','headEntrySha256','headAnchorSha256','currentCheckpointRef','currentTrustPolicySnapshotSha256']) if (snapshot[field] !== expected[field]) errors.push(`Policy-anchor history snapshot ${field} mismatch.`);
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function verifyCurrentReviewerTrustPolicyAnchor({ anchor, history, historySnapshot }) {
  const errors = [];
  const anchorVerification = verifyAnchorSelf(anchor);
  errors.push(...anchorVerification.errors.map(error=>`Anchor: ${error}`));
  const snapshotVerification = verifyReviewerTrustPolicyAnchorHistorySnapshot(historySnapshot, history);
  errors.push(...snapshotVerification.errors.map(error=>`Anchor history: ${error}`));
  const historyVerification = verifyReviewerTrustPolicyAnchorHistory(history);
  if (anchorVerification.ok && historyVerification.ok && historyVerification.head.anchorSha256 !== anchor.sha256) errors.push('Supplied policy anchor is not the current anchor-history head.');
  return Object.freeze({ ok:errors.length === 0, current:errors.length === 0, errors:Object.freeze(errors) });
}
