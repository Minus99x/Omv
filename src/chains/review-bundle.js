import { evidenceDigest } from '../core/evidence.js';
import { createOperatorAuditIndex, verifyExternalReviewIndex } from './operator-audit-index.js';

const SHA256 = /^[0-9a-f]{64}$/i;
export const CURRENT_REVIEW_BUNDLE_CHECKPOINT = '0.6.41-dev';

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}
function sha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return value.toLowerCase();
}
function bytes(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be a positive safe integer.`);
  return number;
}
function fileRecord(role, file) {
  return Object.freeze({
    role,
    filename: requiredText(file?.filename, `${role}.filename`),
    sha256: sha(file?.sha256, `${role}.sha256`),
    sizeBytes: bytes(file?.sizeBytes, `${role}.sizeBytes`),
    logicalSha256: file?.logicalSha256 == null ? null : sha(file.logicalSha256, `${role}.logicalSha256`)
  });
}

export function createExternalReviewBundleDescriptor({ checkpointRef = CURRENT_REVIEW_BUNDLE_CHECKPOINT, archive, sidecar, reviewIndex, operatorAuditIndex }) {
  const archiveFile = fileRecord('source-archive', archive);
  const sidecarFile = fileRecord('checkpoint-sidecar', sidecar);
  const reviewFile = fileRecord('external-review-index', reviewIndex);
  const checkpoint = requiredText(checkpointRef, 'checkpointRef');
  const auditIndex = operatorAuditIndex ?? createOperatorAuditIndex({ checkpointRef: checkpoint });
  const ext = reviewIndex?.parsed;
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) throw new TypeError('reviewIndex.parsed is required.');
  const identity = {
    checkpointRef: checkpoint,
    archiveFilename: archiveFile.filename,
    archiveSha256: archiveFile.sha256,
    sidecarFilename: sidecarFile.filename,
    sidecarFileSha256: sidecarFile.sha256,
    checkpointManifestSha256: sidecarFile.logicalSha256,
    sourceTreeSha256: ext?.checkpointIdentity?.sourceTreeSha256,
    dependencyLockSha256: ext?.checkpointIdentity?.dependencyLockSha256
  };
  const externalVerification = verifyExternalReviewIndex(ext, { operatorAuditIndex: auditIndex, checkpointIdentity: identity });
  if (!externalVerification.ok) throw new Error(`External review index is invalid: ${externalVerification.errors.join('; ')}`);
  if (reviewFile.logicalSha256 !== ext.sha256) throw new Error('External review-index logical digest does not match parsed review index.');
  if (sidecarFile.logicalSha256 !== ext.checkpointIdentity.checkpointManifestSha256) throw new Error('Checkpoint sidecar logical digest does not match review index.');

  const core = Object.freeze({
    schema: 'omegavault.external-review-bundle.v1',
    checkpointRef: checkpoint,
    files: Object.freeze([archiveFile, sidecarFile, reviewFile]),
    bindings: Object.freeze({
      operatorAuditIndexSha256: auditIndex.sha256,
      provenanceAuditSha256: auditIndex.provenanceAuditSha256,
      evidenceHistorySha256: auditIndex.evidenceHistorySha256,
      checkpointManifestSha256: sidecarFile.logicalSha256,
      externalReviewIndexSha256: reviewFile.logicalSha256,
      sourceTreeSha256: ext.checkpointIdentity.sourceTreeSha256,
      dependencyLockSha256: ext.checkpointIdentity.dependencyLockSha256
    }),
    verificationPlan: Object.freeze([
      Object.freeze({ id: 'archive-file-sha256', rule: 'sha256(source-archive bytes) == files[source-archive].sha256' }),
      Object.freeze({ id: 'sidecar-file-sha256', rule: 'sha256(checkpoint-sidecar bytes) == files[checkpoint-sidecar].sha256' }),
      Object.freeze({ id: 'review-index-file-sha256', rule: 'sha256(external-review-index bytes) == files[external-review-index].sha256' }),
      Object.freeze({ id: 'sidecar-logical-binding', rule: 'checkpoint-sidecar logical sha256 == bindings.checkpointManifestSha256' }),
      Object.freeze({ id: 'review-index-logical-binding', rule: 'external-review-index logical sha256 == bindings.externalReviewIndexSha256' }),
      Object.freeze({ id: 'review-index-cross-bindings', rule: 'external-review-index validates archive, sidecar, source-tree, dependency-lock, audit and history bindings' })
    ]),
    semantics: Object.freeze({
      generatedAfterArchiveSeal: true,
      archiveSelfHashEmbedded: false,
      promotionAuthority: 'backend-capability-contract-only',
      lineageAuthority: 'explicit-cryptographic-parent-bindings-only'
    })
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyExternalReviewBundleDescriptor(descriptor, inputs) {
  const errors = [];
  let expected;
  try { expected = createExternalReviewBundleDescriptor(inputs); }
  catch (error) { return Object.freeze({ ok: false, errors: Object.freeze([String(error?.message || error)]) }); }
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return Object.freeze({ ok: false, errors: Object.freeze(['Review bundle descriptor must be an object.']) });
  if (descriptor.schema !== expected.schema) errors.push('Unexpected review-bundle schema.');
  if (descriptor.sha256 !== expected.sha256) errors.push('Review-bundle descriptor digest mismatch.');
  if (evidenceDigest(descriptor.files ?? null) !== evidenceDigest(expected.files)) errors.push('Review-bundle file inventory mismatch.');
  if (evidenceDigest(descriptor.bindings ?? null) !== evidenceDigest(expected.bindings)) errors.push('Review-bundle binding mismatch.');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
