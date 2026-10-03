import { createHash, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { evidenceDigest } from './evidence.js';
import { verifyReviewerTrustPolicyAnchorHistory, verifyReviewerTrustPolicyAnchorHistorySnapshot } from './reviewer-trust-policy-anchor-history.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function validDigest(value) { return typeof value === 'string' && SHA256.test(value); }
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
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  return normalized;
}
function noAuthority(authority, scope) {
  const expectedKeys=['anchoringAuthorityTrust','chainMaturity','chainPromotion','deploymentAuthority','evidencePromotion','reviewerTrust','scope','walletAuthority'];
  return authority && typeof authority === 'object' && !Array.isArray(authority)
    && JSON.stringify(Object.keys(authority).sort()) === JSON.stringify(expectedKeys)
    && authority.reviewerTrust === false
    && authority?.anchoringAuthorityTrust === false
    && authority?.chainMaturity === false
    && authority?.chainPromotion === false
    && authority?.evidencePromotion === false
    && authority?.deploymentAuthority === false
    && authority?.walletAuthority === false
    && authority?.scope === scope;
}
function authority(scope) {
  return Object.freeze({
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
function asPublicKey(publicKey) { return publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey); }

export function publisherPublicKeyFingerprint(publicKey) {
  return createHash('sha256').update(asPublicKey(publicKey).export({ type:'spki', format:'der' })).digest('hex');
}

export function createPublicationHeadReceipt({ history, historySnapshot, publisher, publishedAt }) {
  const snapshotVerification = verifyReviewerTrustPolicyAnchorHistorySnapshot(historySnapshot, history);
  if (!snapshotVerification.ok) throw new Error(`Cannot publish an invalid anchor-history head: ${snapshotVerification.errors.join('; ')}`);
  const historyVerification = verifyReviewerTrustPolicyAnchorHistory(history);
  if (!historyVerification.ok) throw new Error(`Cannot publish invalid anchor history: ${historyVerification.errors.join('; ')}`);
  const core = Object.freeze({
    schema:'omegavault.reviewer-trust-policy-anchor-history-publication-receipt.v1',
    publisher:requiredText(publisher, 'publisher'),
    publishedAt:canonicalTimestamp(publishedAt, 'publishedAt'),
    anchorHistory:Object.freeze({
      snapshotSha256:historySnapshot.sha256,
      reviewer:historySnapshot.reviewer,
      entryCount:historySnapshot.entryCount,
      headEntrySha256:historySnapshot.headEntrySha256,
      headAnchorSha256:historySnapshot.headAnchorSha256,
      checkpointRef:historySnapshot.currentCheckpointRef,
      trustPolicySnapshotSha256:historySnapshot.currentTrustPolicySnapshotSha256
    }),
    authority:authority('anchor-history-head-publication-only'),
    signatureStatus:'unsigned'
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyPublicationHeadReceipt(receipt, { history, historySnapshot }) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return Object.freeze({ ok:false, current:false, errors:Object.freeze(['Publication receipt must be an object.']) });
  if (!exactKeys(receipt,['schema','publisher','publishedAt','anchorHistory','authority','signatureStatus','sha256'])) errors.push('Publication receipt fields are not canonical.');
  if (!exactKeys(receipt.anchorHistory,['snapshotSha256','reviewer','entryCount','headEntrySha256','headAnchorSha256','checkpointRef','trustPolicySnapshotSha256'])) errors.push('Publication receipt anchorHistory fields are not canonical.');
  if (receipt.schema !== 'omegavault.reviewer-trust-policy-anchor-history-publication-receipt.v1') errors.push('Unexpected publication-receipt schema.');
  if (typeof receipt.publisher !== 'string' || !receipt.publisher.trim()) errors.push('Publication receipt publisher is required.');
  if (typeof receipt.publishedAt !== 'string' || !Number.isFinite(Date.parse(receipt.publishedAt)) || new Date(receipt.publishedAt).toISOString() !== receipt.publishedAt) errors.push('Publication receipt timestamp must be canonical ISO.');
  if (receipt.signatureStatus !== 'unsigned') errors.push('Base publication receipt must remain unsigned; publisher authentication is detached.');
  if (!noAuthority(receipt.authority, 'anchor-history-head-publication-only')) errors.push('Publication receipt must have publication-only scope and no trust, chain, evidence, deployment or wallet authority.');
  if (!validDigest(receipt.sha256)) errors.push('Publication-receipt SHA-256 is invalid.');
  else { const { sha256, ...unsigned } = receipt; if (evidenceDigest(unsigned) !== sha256) errors.push('Publication-receipt digest mismatch.'); }
  const snapshotVerification = verifyReviewerTrustPolicyAnchorHistorySnapshot(historySnapshot, history);
  errors.push(...snapshotVerification.errors.map(error=>`Anchor history: ${error}`));
  if (snapshotVerification.ok) {
    const expected = {
      snapshotSha256:historySnapshot.sha256,
      reviewer:historySnapshot.reviewer,
      entryCount:historySnapshot.entryCount,
      headEntrySha256:historySnapshot.headEntrySha256,
      headAnchorSha256:historySnapshot.headAnchorSha256,
      checkpointRef:historySnapshot.currentCheckpointRef,
      trustPolicySnapshotSha256:historySnapshot.currentTrustPolicySnapshotSha256
    };
    for (const [field,value] of Object.entries(expected)) if (receipt.anchorHistory?.[field] !== value) errors.push(`Publication receipt anchorHistory.${field} mismatch.`);
  }
  return Object.freeze({ ok:errors.length === 0, current:errors.length === 0, errors:Object.freeze(errors) });
}

export function createDetachedPublicationHeadReceiptSignature({ receipt, privateKey, publicKey = null }) {
  if (!receipt || typeof receipt !== 'object') throw new TypeError('receipt is required.');
  if (!privateKey) throw new TypeError('privateKey is required.');
  if (!validDigest(receipt.sha256)) throw new Error('Cannot authenticate a publication receipt without a valid digest.');
  const resolvedPublicKey = publicKey ? asPublicKey(publicKey) : createPublicKey(privateKey);
  const core = Object.freeze({
    schema:'omegavault.reviewer-trust-policy-anchor-history-publication-signature.v1',
    algorithm:'ed25519',
    publisher:requiredText(receipt.publisher, 'receipt.publisher'),
    publicationReceiptSha256:receipt.sha256,
    publicKeySpkiSha256:publisherPublicKeyFingerprint(resolvedPublicKey),
    signatureBase64:cryptoSign(null, Buffer.from(receipt.sha256, 'hex'), privateKey).toString('base64'),
    authority:authority('authenticity-of-publication-receipt-only')
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyDetachedPublicationHeadReceiptSignature(signature, receipt, publicKey) {
  const errors = [];
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) return Object.freeze({ ok:false, authenticated:false, errors:Object.freeze(['Detached publisher signature must be an object.']) });
  if (!exactKeys(signature,['schema','algorithm','publisher','publicationReceiptSha256','publicKeySpkiSha256','signatureBase64','authority','sha256'])) errors.push('Detached publisher-signature fields are not canonical.');
  if (signature.schema !== 'omegavault.reviewer-trust-policy-anchor-history-publication-signature.v1') errors.push('Unexpected detached publisher-signature schema.');
  if (signature.algorithm !== 'ed25519') errors.push('Detached publisher signature algorithm must be ed25519.');
  if (signature.publisher !== receipt?.publisher) errors.push('Detached publisher identity does not match the publication receipt.');
  if (signature.publicationReceiptSha256 !== receipt?.sha256) errors.push('Detached publisher signature references a different publication receipt.');
  if (!noAuthority(signature.authority, 'authenticity-of-publication-receipt-only')) errors.push('Detached publisher signature must authenticate only the publication receipt and confer no other authority.');
  if (!validDigest(signature.publicKeySpkiSha256)) errors.push('Detached publisher public-key fingerprint is invalid.');
  if (typeof signature.signatureBase64 !== 'string' || !signature.signatureBase64) errors.push('Detached publisher signature bytes are required.');
  if (!validDigest(signature.sha256)) errors.push('Detached publisher-signature SHA-256 is invalid.');
  else { const { sha256, ...unsigned } = signature; if (evidenceDigest(unsigned) !== sha256) errors.push('Detached publisher-signature digest mismatch.'); }
  if (!publicKey) errors.push('A publisher public key is required.');
  if (publicKey) {
    try { if (publisherPublicKeyFingerprint(publicKey) !== signature.publicKeySpkiSha256) errors.push('Publisher public key fingerprint does not match the detached signature.'); }
    catch (error) { errors.push(`Publisher public key is invalid: ${error.message}`); }
  }
  if (publicKey && validDigest(receipt?.sha256) && typeof signature.signatureBase64 === 'string' && errors.length === 0) {
    try { if (!cryptoVerify(null, Buffer.from(receipt.sha256, 'hex'), publicKey, Buffer.from(signature.signatureBase64, 'base64'))) errors.push('Detached Ed25519 publisher signature verification failed.'); }
    catch (error) { errors.push(`Detached publisher signature verification failed: ${error.message}`); }
  }
  return Object.freeze({ ok:errors.length === 0, authenticated:errors.length === 0, errors:Object.freeze(errors) });
}
