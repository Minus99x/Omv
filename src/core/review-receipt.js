import { createHash, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { evidenceDigest } from './evidence.js';

const SHA256 = /^[0-9a-f]{64}$/i;
const OUTCOMES = new Set(['verified', 'verified-with-notes', 'rejected']);
const TRUST_STATUSES = new Set(['trusted', 'untrusted', 'revoked']);

function text(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function sha(value, label) {
  const normalized = text(value, label).toLowerCase();
  if (!SHA256.test(normalized)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return normalized;
}

function notesList(value = []) {
  if (!Array.isArray(value)) throw new TypeError('notes must be an array.');
  return Object.freeze(value.map((item, index) => text(item, `notes[${index}]`)));
}

function isoTimestamp(value, label = 'reviewedAt') {
  const normalized = text(value, label);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO-compatible timestamp.`);
  return new Date(time).toISOString();
}

function normalizeReviewIndex(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) throw new TypeError('reviewIndex must be an object.');
  if (index.schema !== 'omegavault.external-review-index.v1') throw new TypeError('reviewIndex must use omegavault.external-review-index.v1.');
  return Object.freeze({
    sha256: sha(index.sha256, 'reviewIndex.sha256'),
    checkpointRef: text(index.checkpoint?.ref, 'reviewIndex.checkpoint.ref'),
    archiveSha256: sha(index.checkpoint?.archiveSha256, 'reviewIndex.checkpoint.archiveSha256'),
    reviewBasisSha256: sha(index.reviewBasis?.sha256, 'reviewIndex.reviewBasis.sha256')
  });
}

export function createExternalReviewReceipt({ reviewIndex, outcome, reviewer, reviewedAt, notes = [] }) {
  const normalizedOutcome = text(outcome, 'outcome');
  if (!OUTCOMES.has(normalizedOutcome)) throw new TypeError(`Unsupported review outcome: ${normalizedOutcome}`);
  const core = Object.freeze({
    schema: 'omegavault.external-review-receipt.v1',
    reviewIndex: normalizeReviewIndex(reviewIndex),
    outcome: normalizedOutcome,
    reviewer: text(reviewer, 'reviewer'),
    reviewedAt: isoTimestamp(reviewedAt),
    notes: notesList(notes),
    authority: Object.freeze({
      chainPromotion: false,
      evidencePromotion: false,
      scope: 'external-review-result-only'
    }),
    signatureStatus: 'unsigned'
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyExternalReviewReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return Object.freeze({ ok: false, errors: Object.freeze(['Receipt must be an object.']) });
  }
  if (receipt.schema !== 'omegavault.external-review-receipt.v1') errors.push('Unexpected review-receipt schema.');
  if (!OUTCOMES.has(receipt.outcome)) errors.push('Unsupported review outcome.');
  if (receipt.authority?.chainPromotion !== false || receipt.authority?.evidencePromotion !== false || receipt.authority?.scope !== 'external-review-result-only') {
    errors.push('Review receipt authority must remain external-review-result-only with no promotion authority.');
  }
  if (receipt.signatureStatus !== 'unsigned') errors.push('Base review receipt must remain unsigned; signatures are detached.');
  if (typeof receipt.sha256 !== 'string' || !SHA256.test(receipt.sha256)) errors.push('Review-receipt SHA-256 is invalid.');
  else {
    const { sha256: digest, ...unsigned } = receipt;
    if (evidenceDigest(unsigned) !== digest) errors.push('Review-receipt digest mismatch.');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function asPublicKey(publicKey) {
  return publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey);
}

export function reviewerPublicKeyFingerprint(publicKey) {
  const key = asPublicKey(publicKey);
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export function createDetachedReviewReceiptSignature({ receipt, privateKey, publicKey = null }) {
  const receiptVerification = verifyExternalReviewReceipt(receipt);
  if (!receiptVerification.ok) throw new Error(`Cannot sign invalid review receipt: ${receiptVerification.errors.join('; ')}`);
  if (!privateKey) throw new TypeError('privateKey is required.');
  const resolvedPublicKey = publicKey ? asPublicKey(publicKey) : createPublicKey(privateKey);
  const signatureBytes = cryptoSign(null, Buffer.from(receipt.sha256, 'hex'), privateKey);
  const core = Object.freeze({
    schema: 'omegavault.external-review-receipt-signature.v1',
    algorithm: 'ed25519',
    receiptSha256: receipt.sha256,
    publicKeySpkiSha256: reviewerPublicKeyFingerprint(resolvedPublicKey),
    signatureBase64: signatureBytes.toString('base64'),
    authority: Object.freeze({
      chainPromotion: false,
      evidencePromotion: false,
      scope: 'authenticity-of-review-receipt-only'
    })
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyDetachedReviewReceiptSignature(signature, receipt, publicKey) {
  const errors = [];
  const receiptVerification = verifyExternalReviewReceipt(receipt);
  if (!receiptVerification.ok) errors.push(...receiptVerification.errors.map(error => `Receipt: ${error}`));
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
    errors.push('Detached signature must be an object.');
    return Object.freeze({ ok: false, authenticated: false, errors: Object.freeze(errors) });
  }
  if (signature.schema !== 'omegavault.external-review-receipt-signature.v1') errors.push('Unexpected detached-signature schema.');
  if (signature.algorithm !== 'ed25519') errors.push('Detached signature algorithm must be ed25519.');
  if (signature.receiptSha256 !== receipt?.sha256) errors.push('Detached signature references a different receipt digest.');
  if (signature.authority?.chainPromotion !== false || signature.authority?.evidencePromotion !== false || signature.authority?.scope !== 'authenticity-of-review-receipt-only') {
    errors.push('Detached signature authority must be limited to receipt authenticity.');
  }
  if (typeof signature.sha256 !== 'string' || !SHA256.test(signature.sha256)) errors.push('Detached-signature SHA-256 is invalid.');
  else {
    const { sha256: digest, ...unsigned } = signature;
    if (evidenceDigest(unsigned) !== digest) errors.push('Detached-signature digest mismatch.');
  }
  if (!publicKey) errors.push('A public key is required to authenticate the detached signature.');
  if (publicKey && typeof signature.publicKeySpkiSha256 === 'string') {
    try {
      if (reviewerPublicKeyFingerprint(publicKey) !== signature.publicKeySpkiSha256) errors.push('Public key fingerprint does not match the detached signature.');
    } catch (error) { errors.push(`Public key is invalid: ${error.message}`); }
  }
  if (publicKey && typeof signature.signatureBase64 === 'string' && receipt?.sha256 && errors.length === 0) {
    try {
      const valid = cryptoVerify(null, Buffer.from(receipt.sha256, 'hex'), publicKey, Buffer.from(signature.signatureBase64, 'base64'));
      if (!valid) errors.push('Detached Ed25519 signature verification failed.');
    } catch (error) { errors.push(`Detached signature verification failed: ${error.message}`); }
  }
  return Object.freeze({ ok: errors.length === 0, authenticated: errors.length === 0, errors: Object.freeze(errors) });
}

export function createReviewerKeyTrustMetadata({ reviewer, publicKey, status, configuredBy, configuredAt }) {
  const normalizedStatus = text(status, 'status');
  if (!TRUST_STATUSES.has(normalizedStatus)) throw new TypeError(`Unsupported reviewer-key trust status: ${normalizedStatus}`);
  const core = Object.freeze({
    schema: 'omegavault.reviewer-key-trust.v1',
    reviewer: text(reviewer, 'reviewer'),
    publicKeySpkiSha256: reviewerPublicKeyFingerprint(publicKey),
    status: normalizedStatus,
    configuredBy: text(configuredBy, 'configuredBy'),
    configuredAt: isoTimestamp(configuredAt, 'configuredAt'),
    scope: 'external-review-receipt-signer',
    authority: Object.freeze({
      chainPromotion: false,
      evidencePromotion: false,
      scope: 'reviewer-key-trust-only'
    })
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyReviewerKeyTrustMetadata(metadata) {
  const errors = [];
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return Object.freeze({ ok: false, errors: Object.freeze(['Reviewer-key trust metadata must be an object.']) });
  }
  if (metadata.schema !== 'omegavault.reviewer-key-trust.v1') errors.push('Unexpected reviewer-key trust schema.');
  if (typeof metadata.reviewer !== 'string' || !metadata.reviewer.trim()) errors.push('Reviewer-key trust reviewer is required.');
  if (typeof metadata.publicKeySpkiSha256 !== 'string' || !SHA256.test(metadata.publicKeySpkiSha256)) errors.push('Reviewer-key fingerprint is invalid.');
  if (!TRUST_STATUSES.has(metadata.status)) errors.push('Reviewer-key trust status is invalid.');
  if (typeof metadata.configuredBy !== 'string' || !metadata.configuredBy.trim()) errors.push('Reviewer-key trust configuration authority is required.');
  if (typeof metadata.configuredAt !== 'string' || !Number.isFinite(Date.parse(metadata.configuredAt)) || new Date(metadata.configuredAt).toISOString() !== metadata.configuredAt) errors.push('Reviewer-key trust timestamp must be canonical ISO.');
  if (metadata.scope !== 'external-review-receipt-signer') errors.push('Reviewer-key trust scope is invalid.');
  if (metadata.authority?.chainPromotion !== false || metadata.authority?.evidencePromotion !== false || metadata.authority?.scope !== 'reviewer-key-trust-only') {
    errors.push('Reviewer-key trust metadata must have no chain or evidence promotion authority.');
  }
  if (typeof metadata.sha256 !== 'string' || !SHA256.test(metadata.sha256)) errors.push('Reviewer-key trust SHA-256 is invalid.');
  else {
    const { sha256: digest, ...unsigned } = metadata;
    if (evidenceDigest(unsigned) !== digest) errors.push('Reviewer-key trust digest mismatch.');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function assessReviewerKeyTrust({ receipt, signature, publicKey, trustMetadata = null }) {
  const signatureVerification = verifyDetachedReviewReceiptSignature(signature, receipt, publicKey);
  if (!trustMetadata) {
    return Object.freeze({
      ok: signatureVerification.ok,
      signatureAuthenticated: signatureVerification.authenticated,
      trustConfigured: false,
      trustMetadataValid: false,
      reviewerIdentityMatched: false,
      reviewerTrusted: false,
      trustStatus: 'not-configured',
      decision: signatureVerification.authenticated ? 'authenticated-untrusted' : 'unauthenticated',
      errors: signatureVerification.errors
    });
  }

  const trustVerification = verifyReviewerKeyTrustMetadata(trustMetadata);
  const errors = [...signatureVerification.errors, ...trustVerification.errors.map(error => `Trust: ${error}`)];
  let keyMatched = false;
  try {
    keyMatched = reviewerPublicKeyFingerprint(publicKey) === trustMetadata.publicKeySpkiSha256
      && signature?.publicKeySpkiSha256 === trustMetadata.publicKeySpkiSha256;
  } catch (error) { errors.push(`Trust: public key is invalid: ${error.message}`); }
  const reviewerIdentityMatched = receipt?.reviewer === trustMetadata.reviewer;
  if (trustVerification.ok && !keyMatched) errors.push('Trust: configured reviewer key does not match the authenticated signature key.');
  if (trustVerification.ok && !reviewerIdentityMatched) errors.push('Trust: receipt reviewer does not match the configured reviewer identity.');
  const reviewerTrusted = signatureVerification.authenticated
    && trustVerification.ok
    && keyMatched
    && reviewerIdentityMatched
    && trustMetadata.status === 'trusted';
  return Object.freeze({
    ok: errors.length === 0,
    signatureAuthenticated: signatureVerification.authenticated,
    trustConfigured: true,
    trustMetadataValid: trustVerification.ok,
    reviewerIdentityMatched,
    reviewerTrusted,
    trustStatus: trustVerification.ok ? trustMetadata.status : 'invalid',
    decision: reviewerTrusted ? 'trusted-authenticated' : (signatureVerification.authenticated ? 'authenticated-untrusted' : 'unauthenticated'),
    errors: Object.freeze(errors)
  });
}
