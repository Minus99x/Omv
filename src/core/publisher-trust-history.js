import { publisherPublicKeyFingerprint, verifyDetachedPublicationHeadReceiptSignature } from './publication-head-receipt.js';
import { evidenceDigest } from './evidence.js';

const SHA256 = /^[0-9a-f]{64}$/i;
const ACTIONS = new Set(['enroll', 'rotate', 'revoke']);
const EVENT_AUTHORITY_KEYS = ['anchoringAuthorityTrust','chainMaturity','chainPromotion','deploymentAuthority','evidencePromotion','publisherTrust','reviewerTrust','scope','walletAuthority'];
const SNAPSHOT_AUTHORITY_KEYS = ['anchoringAuthorityTrust','chainMaturity','chainPromotion','deploymentAuthority','evidencePromotion','publisherTrust','reviewerTrust','scope','walletAuthority'];

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
function requiredText(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}
function canonicalTimestamp(value, label) {
  const normalized = requiredText(value, label);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== normalized) throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  return normalized;
}
function noAuthority(authority, scope, expectedKeys) {
  return exactKeys(authority, expectedKeys)
    && authority.publisherTrust === false
    && authority.reviewerTrust === false
    && authority.anchoringAuthorityTrust === false
    && authority.chainMaturity === false
    && authority.chainPromotion === false
    && authority.evidencePromotion === false
    && authority.deploymentAuthority === false
    && authority.walletAuthority === false
    && authority.scope === scope;
}
function authority(scope) {
  return Object.freeze({
    publisherTrust:false,
    reviewerTrust:false,
    anchoringAuthorityTrust:false,
    chainMaturity:false,
    chainPromotion:false,
    evidencePromotion:false,
    deploymentAuthority:false,
    walletAuthority:false,
    scope
  });
}
function validatePreviousEvent(previousEvent) {
  if (!previousEvent) return null;
  const verification = verifyPublisherTrustEvent(previousEvent);
  if (!verification.ok) throw new Error(`previousEvent is invalid: ${verification.errors.join('; ')}`);
  return previousEvent;
}

export function createPublisherTrustEvent({ publisher, publicKey, action, configuredBy, configuredAt, previousEvent = null, reason = null }) {
  const normalizedAction = requiredText(action, 'action');
  if (!ACTIONS.has(normalizedAction)) throw new TypeError(`Unsupported publisher trust action: ${normalizedAction}`);
  const previous = validatePreviousEvent(previousEvent);
  if (!previous && normalizedAction !== 'enroll') throw new TypeError('The first publisher trust event must be enroll.');
  if (previous && normalizedAction === 'enroll') throw new TypeError('Enroll may only be the first publisher trust event.');
  if (previous?.action === 'revoke') throw new TypeError('No publisher trust event may follow revocation.');

  const identity = requiredText(publisher, 'publisher');
  const fingerprint = publisherPublicKeyFingerprint(publicKey);
  if (previous && previous.publisher !== identity) throw new TypeError('Publisher identity must remain constant across trust history.');
  if (normalizedAction === 'rotate' && fingerprint === previous.publicKeySpkiSha256) throw new TypeError('Rotation requires a different publisher key.');
  if (normalizedAction === 'revoke' && fingerprint !== previous.publicKeySpkiSha256) throw new TypeError('Revocation must target the currently active publisher key.');

  const core = Object.freeze({
    schema:'omegavault.publisher-key-trust-event.v1',
    sequence:previous ? previous.sequence + 1 : 1,
    publisher:identity,
    action:normalizedAction,
    publicKeySpkiSha256:fingerprint,
    previousEventSha256:previous?.sha256 ?? null,
    previousPublicKeySpkiSha256:previous?.publicKeySpkiSha256 ?? null,
    configuredBy:requiredText(configuredBy, 'configuredBy'),
    configuredAt:canonicalTimestamp(configuredAt, 'configuredAt'),
    reason:reason == null ? null : requiredText(reason, 'reason'),
    authority:authority('publisher-key-trust-history-only')
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyPublisherTrustEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return Object.freeze({ ok:false, errors:Object.freeze(['Publisher trust event must be an object.']) });
  }
  if (!exactKeys(event,['schema','sequence','publisher','action','publicKeySpkiSha256','previousEventSha256','previousPublicKeySpkiSha256','configuredBy','configuredAt','reason','authority','sha256'])) errors.push('Publisher trust event fields are not canonical.');
  if (event.schema !== 'omegavault.publisher-key-trust-event.v1') errors.push('Unexpected publisher trust event schema.');
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) errors.push('Publisher trust event sequence must be a positive safe integer.');
  if (typeof event.publisher !== 'string' || !event.publisher.trim()) errors.push('Publisher trust event publisher is required.');
  if (!ACTIONS.has(event.action)) errors.push('Publisher trust event action is invalid.');
  if (typeof event.publicKeySpkiSha256 !== 'string' || !SHA256.test(event.publicKeySpkiSha256)) errors.push('Publisher trust event key fingerprint is invalid.');
  if (event.previousEventSha256 !== null && (typeof event.previousEventSha256 !== 'string' || !SHA256.test(event.previousEventSha256))) errors.push('Previous publisher trust event digest is invalid.');
  if (event.previousPublicKeySpkiSha256 !== null && (typeof event.previousPublicKeySpkiSha256 !== 'string' || !SHA256.test(event.previousPublicKeySpkiSha256))) errors.push('Previous publisher key fingerprint is invalid.');
  if (typeof event.configuredBy !== 'string' || !event.configuredBy.trim()) errors.push('Publisher trust event configuration authority is required.');
  if (typeof event.configuredAt !== 'string' || !Number.isFinite(Date.parse(event.configuredAt)) || new Date(event.configuredAt).toISOString() !== event.configuredAt) errors.push('Publisher trust event timestamp must be canonical ISO.');
  if (event.reason !== null && (typeof event.reason !== 'string' || !event.reason.trim())) errors.push('Publisher trust event reason must be null or non-empty text.');
  if (!noAuthority(event.authority,'publisher-key-trust-history-only',EVENT_AUTHORITY_KEYS)) errors.push('Publisher trust event must have trust-history-only scope and no trust, chain, evidence, deployment or wallet authority.');
  if (typeof event.sha256 !== 'string' || !SHA256.test(event.sha256)) errors.push('Publisher trust event SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned } = event;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Publisher trust event digest mismatch.');
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function verifyPublisherTrustHistory(events) {
  const errors = [];
  if (!Array.isArray(events) || events.length === 0) {
    return Object.freeze({ ok:false, publisher:null, currentKeySpkiSha256:null, status:'invalid', headSha256:null, errors:Object.freeze(['Publisher trust history must be a non-empty array.']) });
  }
  let previous = null;
  for (const [index, event] of events.entries()) {
    const verification = verifyPublisherTrustEvent(event);
    errors.push(...verification.errors.map(error => `Event ${index + 1}: ${error}`));
    if (event?.sequence !== index + 1) errors.push(`Event ${index + 1}: sequence is not contiguous.`);
    if (index === 0) {
      if (event?.action !== 'enroll') errors.push('Event 1: history must begin with enroll.');
      if (event?.previousEventSha256 !== null || event?.previousPublicKeySpkiSha256 !== null) errors.push('Event 1: initial event must not reference a predecessor.');
    } else {
      if (event?.publisher !== previous?.publisher) errors.push(`Event ${index + 1}: publisher identity changed.`);
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
    ok:valid,
    publisher:valid ? previous.publisher : null,
    currentKeySpkiSha256:valid ? previous.publicKeySpkiSha256 : null,
    status:valid ? (previous.action === 'revoke' ? 'revoked' : 'trusted') : 'invalid',
    headSha256:valid ? previous.sha256 : null,
    errors:Object.freeze(errors)
  });
}

export function createPublisherTrustHistorySnapshot(events) {
  const verification = verifyPublisherTrustHistory(events);
  if (!verification.ok) throw new Error(`Cannot snapshot invalid publisher trust history: ${verification.errors.join('; ')}`);
  const core = Object.freeze({
    schema:'omegavault.publisher-key-trust-history-snapshot.v1',
    publisher:verification.publisher,
    eventCount:events.length,
    headSha256:verification.headSha256,
    currentKeySpkiSha256:verification.currentKeySpkiSha256,
    status:verification.status,
    authority:authority('publisher-key-trust-history-integrity-only')
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyPublisherTrustHistorySnapshot(snapshot, events) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return Object.freeze({ ok:false, errors:Object.freeze(['Publisher trust history snapshot must be an object.']) });
  }
  if (!exactKeys(snapshot,['schema','publisher','eventCount','headSha256','currentKeySpkiSha256','status','authority','sha256'])) errors.push('Publisher trust history snapshot fields are not canonical.');
  if (snapshot.schema !== 'omegavault.publisher-key-trust-history-snapshot.v1') errors.push('Unexpected publisher trust history snapshot schema.');
  if (!noAuthority(snapshot.authority,'publisher-key-trust-history-integrity-only',SNAPSHOT_AUTHORITY_KEYS)) errors.push('Publisher trust history snapshot must have integrity-only scope and no trust, chain, evidence, deployment or wallet authority.');
  if (typeof snapshot.sha256 !== 'string' || !SHA256.test(snapshot.sha256)) errors.push('Publisher trust history snapshot SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned } = snapshot;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Publisher trust history snapshot digest mismatch.');
  }
  const history = verifyPublisherTrustHistory(events);
  errors.push(...history.errors.map(error=>`History: ${error}`));
  if (history.ok) {
    if (snapshot.publisher !== history.publisher) errors.push('Publisher trust history snapshot publisher mismatch.');
    if (snapshot.eventCount !== events.length) errors.push('Publisher trust history snapshot event-count mismatch.');
    if (snapshot.headSha256 !== history.headSha256) errors.push('Publisher trust history snapshot head mismatch.');
    if (snapshot.currentKeySpkiSha256 !== history.currentKeySpkiSha256) errors.push('Publisher trust history snapshot current-key mismatch.');
    if (snapshot.status !== history.status) errors.push('Publisher trust history snapshot status mismatch.');
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function assessPublisherTrustHistory({ receipt, signature, publicKey, trustHistory, trustHistorySnapshot = null }) {
  const signatureVerification = verifyDetachedPublicationHeadReceiptSignature(signature, receipt, publicKey);
  const historyVerification = verifyPublisherTrustHistory(trustHistory);
  const errors = [...signatureVerification.errors, ...historyVerification.errors.map(error=>`Trust history: ${error}`)];
  const snapshotVerification = trustHistorySnapshot ? verifyPublisherTrustHistorySnapshot(trustHistorySnapshot, trustHistory) : null;
  if (snapshotVerification) errors.push(...snapshotVerification.errors.map(error=>`Trust snapshot: ${error}`));

  let keyMatched = false;
  try {
    const fingerprint = publisherPublicKeyFingerprint(publicKey);
    keyMatched = fingerprint === historyVerification.currentKeySpkiSha256 && fingerprint === signature?.publicKeySpkiSha256;
  } catch (error) {
    errors.push(`Trust history: public key is invalid: ${error.message}`);
  }

  const publisherIdentityMatched = receipt?.publisher === historyVerification.publisher;
  if (historyVerification.ok && !keyMatched) errors.push('Trust history: authenticated signature key is not the current publisher key.');
  if (historyVerification.ok && !publisherIdentityMatched) errors.push('Trust history: receipt publisher does not match the configured publisher identity.');

  const publisherTrusted = signatureVerification.authenticated
    && historyVerification.ok
    && keyMatched
    && publisherIdentityMatched
    && historyVerification.status === 'trusted'
    && (!snapshotVerification || snapshotVerification.ok);

  return Object.freeze({
    ok:errors.length === 0,
    signatureAuthenticated:signatureVerification.authenticated,
    trustConfigured:true,
    trustHistoryValid:historyVerification.ok,
    trustHistorySnapshotConfigured:Boolean(trustHistorySnapshot),
    trustHistorySnapshotValid:snapshotVerification?.ok ?? false,
    trustHistoryHeadSha256:historyVerification.headSha256,
    publisherIdentityMatched,
    publisherTrusted,
    trustStatus:historyVerification.status,
    decision:publisherTrusted ? 'trusted-authenticated' : (signatureVerification.authenticated ? 'authenticated-untrusted' : 'unauthenticated'),
    errors:Object.freeze(errors)
  });
}
