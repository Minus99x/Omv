import { reviewerPublicKeyFingerprint, verifyDetachedReviewReceiptSignature } from './review-receipt.js';
import { evidenceDigest } from './evidence.js';

const SHA256 = /^[0-9a-f]{64}$/i;
const ACTIONS = new Set(['enroll', 'rotate', 'revoke']);

function requiredText(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function canonicalTimestamp(value, label) {
  const normalized = requiredText(value, label);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO-compatible timestamp.`);
  return new Date(time).toISOString();
}

function validatePreviousEvent(previousEvent) {
  if (!previousEvent) return null;
  const verification = verifyReviewerTrustEvent(previousEvent);
  if (!verification.ok) throw new Error(`previousEvent is invalid: ${verification.errors.join('; ')}`);
  return previousEvent;
}

export function createReviewerTrustEvent({ reviewer, publicKey, action, configuredBy, configuredAt, previousEvent = null, reason = null }) {
  const normalizedAction = requiredText(action, 'action');
  if (!ACTIONS.has(normalizedAction)) throw new TypeError(`Unsupported reviewer trust action: ${normalizedAction}`);
  const previous = validatePreviousEvent(previousEvent);
  if (!previous && normalizedAction !== 'enroll') throw new TypeError('The first reviewer trust event must be enroll.');
  if (previous && normalizedAction === 'enroll') throw new TypeError('Enroll may only be the first reviewer trust event.');
  if (previous?.action === 'revoke') throw new TypeError('No reviewer trust event may follow revocation.');

  const fingerprint = reviewerPublicKeyFingerprint(publicKey);
  if (previous && previous.reviewer !== requiredText(reviewer, 'reviewer')) throw new TypeError('Reviewer identity must remain constant across trust history.');
  if (normalizedAction === 'rotate' && fingerprint === previous.publicKeySpkiSha256) throw new TypeError('Rotation requires a different reviewer key.');
  if (normalizedAction === 'revoke' && fingerprint !== previous.publicKeySpkiSha256) throw new TypeError('Revocation must target the currently active reviewer key.');

  const core = Object.freeze({
    schema: 'omegavault.reviewer-key-trust-event.v1',
    sequence: previous ? previous.sequence + 1 : 1,
    reviewer: requiredText(reviewer, 'reviewer'),
    action: normalizedAction,
    publicKeySpkiSha256: fingerprint,
    previousEventSha256: previous?.sha256 ?? null,
    previousPublicKeySpkiSha256: previous?.publicKeySpkiSha256 ?? null,
    configuredBy: requiredText(configuredBy, 'configuredBy'),
    configuredAt: canonicalTimestamp(configuredAt, 'configuredAt'),
    reason: reason == null ? null : requiredText(reason, 'reason'),
    authority: Object.freeze({
      chainPromotion: false,
      evidencePromotion: false,
      scope: 'reviewer-key-trust-history-only'
    })
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyReviewerTrustEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return Object.freeze({ ok: false, errors: Object.freeze(['Reviewer trust event must be an object.']) });
  }
  if (event.schema !== 'omegavault.reviewer-key-trust-event.v1') errors.push('Unexpected reviewer trust event schema.');
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) errors.push('Reviewer trust event sequence must be a positive safe integer.');
  if (typeof event.reviewer !== 'string' || !event.reviewer.trim()) errors.push('Reviewer trust event reviewer is required.');
  if (!ACTIONS.has(event.action)) errors.push('Reviewer trust event action is invalid.');
  if (typeof event.publicKeySpkiSha256 !== 'string' || !SHA256.test(event.publicKeySpkiSha256)) errors.push('Reviewer trust event key fingerprint is invalid.');
  if (event.previousEventSha256 !== null && (typeof event.previousEventSha256 !== 'string' || !SHA256.test(event.previousEventSha256))) errors.push('Previous reviewer trust event digest is invalid.');
  if (event.previousPublicKeySpkiSha256 !== null && (typeof event.previousPublicKeySpkiSha256 !== 'string' || !SHA256.test(event.previousPublicKeySpkiSha256))) errors.push('Previous reviewer key fingerprint is invalid.');
  if (typeof event.configuredBy !== 'string' || !event.configuredBy.trim()) errors.push('Reviewer trust event configuration authority is required.');
  if (typeof event.configuredAt !== 'string' || !Number.isFinite(Date.parse(event.configuredAt)) || new Date(event.configuredAt).toISOString() !== event.configuredAt) errors.push('Reviewer trust event timestamp must be canonical ISO.');
  if (event.reason !== null && (typeof event.reason !== 'string' || !event.reason.trim())) errors.push('Reviewer trust event reason must be null or non-empty text.');
  if (event.authority?.chainPromotion !== false || event.authority?.evidencePromotion !== false || event.authority?.scope !== 'reviewer-key-trust-history-only') errors.push('Reviewer trust event must have no promotion authority.');
  if (typeof event.sha256 !== 'string' || !SHA256.test(event.sha256)) errors.push('Reviewer trust event SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned } = event;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Reviewer trust event digest mismatch.');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function verifyReviewerTrustHistory(events) {
  const errors = [];
  if (!Array.isArray(events) || events.length === 0) {
    return Object.freeze({ ok: false, reviewer: null, currentKeySpkiSha256: null, status: 'invalid', errors: Object.freeze(['Reviewer trust history must be a non-empty array.']) });
  }
  let previous = null;
  for (const [index, event] of events.entries()) {
    const verification = verifyReviewerTrustEvent(event);
    errors.push(...verification.errors.map(error => `Event ${index + 1}: ${error}`));
    if (event?.sequence !== index + 1) errors.push(`Event ${index + 1}: sequence is not contiguous.`);
    if (index === 0) {
      if (event?.action !== 'enroll') errors.push('Event 1: history must begin with enroll.');
      if (event?.previousEventSha256 !== null || event?.previousPublicKeySpkiSha256 !== null) errors.push('Event 1: initial event must not reference a predecessor.');
    } else {
      if (event?.reviewer !== previous?.reviewer) errors.push(`Event ${index + 1}: reviewer identity changed.`);
      if (event?.action === 'enroll') errors.push(`Event ${index + 1}: enroll may only be the initial event.`);
      if (previous?.action === 'revoke') errors.push(`Event ${index + 1}: event follows terminal revocation.`);
      if (event?.previousEventSha256 !== previous?.sha256) errors.push(`Event ${index + 1}: previous event digest mismatch.`);
      if (event?.previousPublicKeySpkiSha256 !== previous?.publicKeySpkiSha256) errors.push(`Event ${index + 1}: previous key fingerprint mismatch.`);
      if (Number.isFinite(Date.parse(event?.configuredAt)) && Number.isFinite(Date.parse(previous?.configuredAt)) && Date.parse(event.configuredAt) <= Date.parse(previous.configuredAt)) errors.push(`Event ${index + 1}: timestamp must increase strictly.`);
      if (event?.action === 'rotate' && event?.publicKeySpkiSha256 === previous?.publicKeySpkiSha256) errors.push(`Event ${index + 1}: rotation did not change the key.`);
      if (event?.action === 'revoke' && event?.publicKeySpkiSha256 !== previous?.publicKeySpkiSha256) errors.push(`Event ${index + 1}: revocation does not target the active key.`);
    }
    previous = event;
  }
  const valid = errors.length === 0;
  return Object.freeze({
    ok: valid,
    reviewer: valid ? previous.reviewer : null,
    currentKeySpkiSha256: valid ? previous.publicKeySpkiSha256 : null,
    status: valid ? (previous.action === 'revoke' ? 'revoked' : 'trusted') : 'invalid',
    headSha256: valid ? previous.sha256 : null,
    errors: Object.freeze(errors)
  });
}

export function createReviewerTrustHistorySnapshot(events) {
  const verification = verifyReviewerTrustHistory(events);
  if (!verification.ok) throw new Error(`Cannot snapshot invalid reviewer trust history: ${verification.errors.join('; ')}`);
  const core = Object.freeze({
    schema: 'omegavault.reviewer-key-trust-history-snapshot.v1',
    reviewer: verification.reviewer,
    eventCount: events.length,
    headSha256: verification.headSha256,
    currentKeySpkiSha256: verification.currentKeySpkiSha256,
    status: verification.status,
    authority: Object.freeze({ chainPromotion:false, evidencePromotion:false, scope:'reviewer-key-trust-history-integrity-only' })
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyReviewerTrustHistorySnapshot(snapshot, events) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return Object.freeze({ ok:false, errors:Object.freeze(['Reviewer trust history snapshot must be an object.']) });
  }
  if (snapshot.schema !== 'omegavault.reviewer-key-trust-history-snapshot.v1') errors.push('Unexpected reviewer trust history snapshot schema.');
  if (typeof snapshot.sha256 !== 'string' || !SHA256.test(snapshot.sha256)) errors.push('Reviewer trust history snapshot SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned } = snapshot;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Reviewer trust history snapshot digest mismatch.');
  }
  if (snapshot.authority?.chainPromotion !== false || snapshot.authority?.evidencePromotion !== false || snapshot.authority?.scope !== 'reviewer-key-trust-history-integrity-only') errors.push('Reviewer trust history snapshot must have no promotion authority.');
  const history = verifyReviewerTrustHistory(events);
  errors.push(...history.errors.map(error => `History: ${error}`));
  if (history.ok) {
    if (snapshot.reviewer !== history.reviewer) errors.push('Reviewer trust history snapshot reviewer mismatch.');
    if (snapshot.eventCount !== events.length) errors.push('Reviewer trust history snapshot event-count mismatch.');
    if (snapshot.headSha256 !== history.headSha256) errors.push('Reviewer trust history snapshot head mismatch.');
    if (snapshot.currentKeySpkiSha256 !== history.currentKeySpkiSha256) errors.push('Reviewer trust history snapshot current-key mismatch.');
    if (snapshot.status !== history.status) errors.push('Reviewer trust history snapshot status mismatch.');
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function assessReviewerTrustHistory({ receipt, signature, publicKey, trustHistory, trustHistorySnapshot = null }) {
  const signatureVerification = verifyDetachedReviewReceiptSignature(signature, receipt, publicKey);
  const historyVerification = verifyReviewerTrustHistory(trustHistory);
  const errors = [...signatureVerification.errors, ...historyVerification.errors.map(error => `Trust history: ${error}`)];
  const snapshotVerification = trustHistorySnapshot ? verifyReviewerTrustHistorySnapshot(trustHistorySnapshot, trustHistory) : null;
  if (snapshotVerification) errors.push(...snapshotVerification.errors.map(error => `Trust snapshot: ${error}`));
  let keyMatched = false;
  try {
    const fingerprint = reviewerPublicKeyFingerprint(publicKey);
    keyMatched = fingerprint === historyVerification.currentKeySpkiSha256 && fingerprint === signature?.publicKeySpkiSha256;
  } catch (error) { errors.push(`Trust history: public key is invalid: ${error.message}`); }
  const reviewerIdentityMatched = receipt?.reviewer === historyVerification.reviewer;
  if (historyVerification.ok && !keyMatched) errors.push('Trust history: authenticated signature key is not the current reviewer key.');
  if (historyVerification.ok && !reviewerIdentityMatched) errors.push('Trust history: receipt reviewer does not match the configured reviewer identity.');
  const reviewerTrusted = signatureVerification.authenticated && historyVerification.ok && keyMatched && reviewerIdentityMatched && historyVerification.status === 'trusted';
  return Object.freeze({
    ok: errors.length === 0,
    signatureAuthenticated: signatureVerification.authenticated,
    trustConfigured: true,
    trustHistoryValid: historyVerification.ok,
    trustHistorySnapshotConfigured: Boolean(trustHistorySnapshot),
    trustHistorySnapshotValid: snapshotVerification?.ok ?? false,
    trustHistoryHeadSha256: historyVerification.headSha256,
    reviewerIdentityMatched,
    reviewerTrusted,
    trustStatus: historyVerification.status,
    decision: reviewerTrusted ? 'trusted-authenticated' : (signatureVerification.authenticated ? 'authenticated-untrusted' : 'unauthenticated'),
    errors: Object.freeze(errors)
  });
}
