import { evidenceDigest } from './evidence.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function validDigest(value) { return typeof value === 'string' && SHA256.test(value); }

function verifyPublicationReceiptSelf(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return Object.freeze({ ok:false, errors:Object.freeze(['Publication receipt must be an object.']) });
  if (receipt.schema !== 'omegavault.reviewer-trust-policy-anchor-history-publication-receipt.v1') errors.push('Unexpected publication-receipt schema.');
  if (!validDigest(receipt.sha256)) errors.push('Publication-receipt SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned } = receipt;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Publication-receipt digest mismatch.');
  }
  if (typeof receipt.publisher !== 'string' || !receipt.publisher.trim()) errors.push('Publication receipt publisher is required.');
  if (typeof receipt.publishedAt !== 'string' || !Number.isFinite(Date.parse(receipt.publishedAt)) || new Date(receipt.publishedAt).toISOString() !== receipt.publishedAt) errors.push('Publication receipt timestamp must be canonical ISO.');
  if (!validDigest(receipt.anchorHistory?.snapshotSha256)) errors.push('Publication receipt anchor-history snapshot digest is invalid.');
  if (!validDigest(receipt.anchorHistory?.headEntrySha256)) errors.push('Publication receipt anchor-history head-entry digest is invalid.');
  if (!validDigest(receipt.anchorHistory?.headAnchorSha256)) errors.push('Publication receipt anchor-history head-anchor digest is invalid.');
  if (receipt.signatureStatus !== 'unsigned') errors.push('Base publication receipt must remain unsigned.');
  if (receipt.authority?.reviewerTrust !== false
    || receipt.authority?.anchoringAuthorityTrust !== false
    || receipt.authority?.chainMaturity !== false
    || receipt.authority?.chainPromotion !== false
    || receipt.authority?.evidencePromotion !== false
    || receipt.authority?.deploymentAuthority !== false
    || receipt.authority?.walletAuthority !== false
    || receipt.authority?.scope !== 'anchor-history-head-publication-only') {
    errors.push('Publication receipt authority boundary is invalid.');
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function createPublicationHeadHistoryEntry({ receipt, previousEntry = null }) {
  const receiptVerification = verifyPublicationReceiptSelf(receipt);
  if (!receiptVerification.ok) throw new Error(`Cannot record invalid publication receipt: ${receiptVerification.errors.join('; ')}`);

  if (previousEntry) {
    const previousVerification = verifyPublicationHeadHistoryEntry(previousEntry);
    if (!previousVerification.ok) throw new Error(`Previous publication-history entry is invalid: ${previousVerification.errors.join('; ')}`);
    if (previousEntry.publisher !== receipt.publisher) throw new Error('Publisher identity must remain constant across one publication history.');
    if (previousEntry.publicationReceiptSha256 === receipt.sha256) throw new Error('Publication history cannot record the same receipt twice.');
    if (Date.parse(receipt.publishedAt) <= Date.parse(previousEntry.publishedAt)) throw new Error('Publication timestamp must increase strictly.');
  }

  const core = Object.freeze({
    schema:'omegavault.reviewer-trust-policy-publication-history-entry.v1',
    sequence:previousEntry ? previousEntry.sequence + 1 : 1,
    publisher:receipt.publisher,
    publicationReceiptSha256:receipt.sha256,
    anchorHistorySnapshotSha256:receipt.anchorHistory.snapshotSha256,
    headEntrySha256:receipt.anchorHistory.headEntrySha256,
    headAnchorSha256:receipt.anchorHistory.headAnchorSha256,
    checkpointRef:receipt.anchorHistory.checkpointRef,
    previousEntrySha256:previousEntry?.sha256 ?? null,
    previousPublicationReceiptSha256:previousEntry?.publicationReceiptSha256 ?? null,
    publishedAt:receipt.publishedAt,
    authority:Object.freeze({
      reviewerTrust:false,
      anchoringAuthorityTrust:false,
      chainMaturity:false,
      chainPromotion:false,
      evidencePromotion:false,
      deploymentAuthority:false,
      walletAuthority:false,
      scope:'publication-receipt-lineage-only'
    })
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyPublicationHeadHistoryEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return Object.freeze({ ok:false, errors:Object.freeze(['Publication-history entry must be an object.']) });
  if (entry.schema !== 'omegavault.reviewer-trust-policy-publication-history-entry.v1') errors.push('Unexpected publication-history entry schema.');
  if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 1) errors.push('Publication-history sequence must be a positive safe integer.');
  if (typeof entry.publisher !== 'string' || !entry.publisher.trim()) errors.push('Publication-history publisher is required.');
  for (const [field,label] of [
    ['publicationReceiptSha256','publication receipt'],
    ['anchorHistorySnapshotSha256','anchor-history snapshot'],
    ['headEntrySha256','anchor-history head entry'],
    ['headAnchorSha256','anchor-history head anchor']
  ]) if (!validDigest(entry[field])) errors.push(`Publication-history ${label} digest is invalid.`);
  if (entry.previousEntrySha256 !== null && !validDigest(entry.previousEntrySha256)) errors.push('Previous publication-history entry digest is invalid.');
  if (entry.previousPublicationReceiptSha256 !== null && !validDigest(entry.previousPublicationReceiptSha256)) errors.push('Previous publication-receipt digest is invalid.');
  if (typeof entry.checkpointRef !== 'string' || !entry.checkpointRef.trim()) errors.push('Publication-history checkpoint reference is required.');
  if (typeof entry.publishedAt !== 'string' || !Number.isFinite(Date.parse(entry.publishedAt)) || new Date(entry.publishedAt).toISOString() !== entry.publishedAt) errors.push('Publication-history timestamp must be canonical ISO.');
  const a=entry.authority;
  if (a?.reviewerTrust !== false || a?.anchoringAuthorityTrust !== false || a?.chainMaturity !== false || a?.chainPromotion !== false || a?.evidencePromotion !== false || a?.deploymentAuthority !== false || a?.walletAuthority !== false || a?.scope !== 'publication-receipt-lineage-only') errors.push('Publication-history entry must have lineage-only authority.');
  if (!validDigest(entry.sha256)) errors.push('Publication-history entry SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned } = entry;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Publication-history entry digest mismatch.');
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function verifyPublicationHeadHistory(history) {
  const errors = [];
  if (!Array.isArray(history) || history.length === 0) return Object.freeze({ ok:false, errors:Object.freeze(['Publication history must be a non-empty array.']), head:null });
  const receipts = new Set();
  let previous = null;
  for (const [index,entry] of history.entries()) {
    const verification=verifyPublicationHeadHistoryEntry(entry);
    errors.push(...verification.errors.map(error=>`Entry ${index + 1}: ${error}`));
    if (entry?.sequence !== index + 1) errors.push(`Entry ${index + 1}: sequence is not contiguous.`);
    if (receipts.has(entry?.publicationReceiptSha256)) errors.push(`Entry ${index + 1}: duplicate publication receipt.`);
    receipts.add(entry?.publicationReceiptSha256);
    if (index === 0) {
      if (entry?.previousEntrySha256 !== null || entry?.previousPublicationReceiptSha256 !== null) errors.push('Entry 1: initial publication entry must not reference a predecessor.');
    } else {
      if (entry?.publisher !== previous?.publisher) errors.push(`Entry ${index + 1}: publisher identity changed.`);
      if (entry?.previousEntrySha256 !== previous?.sha256) errors.push(`Entry ${index + 1}: previous entry digest mismatch.`);
      if (entry?.previousPublicationReceiptSha256 !== previous?.publicationReceiptSha256) errors.push(`Entry ${index + 1}: previous publication receipt digest mismatch.`);
      if (Number.isFinite(Date.parse(entry?.publishedAt)) && Number.isFinite(Date.parse(previous?.publishedAt)) && Date.parse(entry.publishedAt) <= Date.parse(previous.publishedAt)) errors.push(`Entry ${index + 1}: publication timestamp must increase strictly.`);
    }
    previous=entry;
  }
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors), head:errors.length === 0 ? previous : null });
}

export function createPublicationHeadHistorySnapshot(history) {
  const verification=verifyPublicationHeadHistory(history);
  if (!verification.ok) throw new Error(`Cannot snapshot invalid publication history: ${verification.errors.join('; ')}`);
  const head=verification.head;
  const core=Object.freeze({
    schema:'omegavault.reviewer-trust-policy-publication-history-snapshot.v1',
    publisher:head.publisher,
    entryCount:history.length,
    headEntrySha256:head.sha256,
    headPublicationReceiptSha256:head.publicationReceiptSha256,
    currentAnchorHistorySnapshotSha256:head.anchorHistorySnapshotSha256,
    currentHeadAnchorSha256:head.headAnchorSha256,
    currentCheckpointRef:head.checkpointRef,
    authority:Object.freeze({
      reviewerTrust:false,
      anchoringAuthorityTrust:false,
      chainMaturity:false,
      chainPromotion:false,
      evidencePromotion:false,
      deploymentAuthority:false,
      walletAuthority:false,
      scope:'publication-receipt-lineage-integrity-only'
    })
  });
  return Object.freeze({ ...core, sha256:evidenceDigest(core) });
}

export function verifyPublicationHeadHistorySnapshot(snapshot, history) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return Object.freeze({ ok:false, errors:Object.freeze(['Publication-history snapshot must be an object.']) });
  if (snapshot.schema !== 'omegavault.reviewer-trust-policy-publication-history-snapshot.v1') errors.push('Unexpected publication-history snapshot schema.');
  if (!validDigest(snapshot.sha256)) errors.push('Publication-history snapshot SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned }=snapshot;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Publication-history snapshot digest mismatch.');
  }
  const verification=verifyPublicationHeadHistory(history);
  errors.push(...verification.errors.map(error=>`History: ${error}`));
  if (verification.ok) {
    const expected=createPublicationHeadHistorySnapshot(history);
    for (const field of ['publisher','entryCount','headEntrySha256','headPublicationReceiptSha256','currentAnchorHistorySnapshotSha256','currentHeadAnchorSha256','currentCheckpointRef']) {
      if (snapshot[field] !== expected[field]) errors.push(`Publication-history snapshot ${field} mismatch.`);
    }
  }
  const a=snapshot.authority;
  if (a?.reviewerTrust !== false || a?.anchoringAuthorityTrust !== false || a?.chainMaturity !== false || a?.chainPromotion !== false || a?.evidencePromotion !== false || a?.deploymentAuthority !== false || a?.walletAuthority !== false || a?.scope !== 'publication-receipt-lineage-integrity-only') errors.push('Publication-history snapshot authority boundary is invalid.');
  return Object.freeze({ ok:errors.length === 0, errors:Object.freeze(errors) });
}

export function verifyCurrentPublicationHeadReceipt({ receipt, history, historySnapshot }) {
  const errors=[];
  const receiptVerification=verifyPublicationReceiptSelf(receipt);
  errors.push(...receiptVerification.errors.map(error=>`Receipt: ${error}`));
  const snapshotVerification=verifyPublicationHeadHistorySnapshot(historySnapshot,history);
  errors.push(...snapshotVerification.errors.map(error=>`Publication history: ${error}`));
  const historyVerification=verifyPublicationHeadHistory(history);
  if (receiptVerification.ok && historyVerification.ok && historyVerification.head.publicationReceiptSha256 !== receipt.sha256) errors.push('Supplied publication receipt is not the current publication-history head.');
  return Object.freeze({ ok:errors.length === 0, current:errors.length === 0, errors:Object.freeze(errors) });
}
