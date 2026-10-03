import { evidenceDigest } from '../core/evidence.js';
import { createProvenanceIntegrityAudit } from './provenance-audit.js';
import { createEvidenceHistoryCatalog } from './evidence-history.js';

const SHA256 = /^[0-9a-f]{64}$/i;
export const CURRENT_AUDIT_INDEX_CHECKPOINT = '0.6.40-dev';

function sha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return value.toLowerCase();
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

export function createOperatorAuditIndex({ checkpointRef = CURRENT_AUDIT_INDEX_CHECKPOINT } = {}) {
  const provenanceAudit = createProvenanceIntegrityAudit();
  const history = createEvidenceHistoryCatalog();
  const historySha256 = evidenceDigest(history);
  const core = Object.freeze({
    schema: 'omegavault.operator-audit-index.v1',
    checkpointRef: requiredText(checkpointRef, 'checkpointRef'),
    provenanceAuditSha256: sha(provenanceAudit.sha256, 'provenanceAuditSha256'),
    evidenceHistorySha256: historySha256,
    evidenceHistory: Object.freeze({
      checkpointCount: history.summary.checkpointCount,
      evidenceRefCount: history.summary.evidenceRefCount,
      earliestCheckpointRef: history.summary.earliestCheckpointRef,
      latestCheckpointRef: history.summary.latestCheckpointRef,
      relationSemantics: history.relationSemantics
    }),
    lineageRecovery: Object.freeze({
      status: provenanceAudit.lineageRecovery.status,
      recoveredBindingCount: provenanceAudit.lineageRecovery.recoveredBindingCount,
      unrecordedRefCount: provenanceAudit.lineageRecovery.unrecordedRefCount,
      authority: provenanceAudit.semantics.lineageAuthority
    }),
    promotionAuthority: provenanceAudit.semantics.promotionAuthority,
    externalCheckpointIdentity: 'attached-after-archive-seal'
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyOperatorAuditIndex(index, { checkpointRef = CURRENT_AUDIT_INDEX_CHECKPOINT } = {}) {
  const errors = [];
  let expected;
  try { expected = createOperatorAuditIndex({ checkpointRef }); }
  catch (error) { return Object.freeze({ ok: false, errors: Object.freeze([String(error?.message || error)]) }); }
  if (!index || typeof index !== 'object' || Array.isArray(index)) return Object.freeze({ ok: false, errors: Object.freeze(['Operator audit index must be an object.']) });
  if (index.schema !== expected.schema) errors.push('Unexpected operator audit-index schema.');
  if (index.sha256 !== expected.sha256) errors.push('Operator audit-index digest mismatch.');
  if (index.provenanceAuditSha256 !== expected.provenanceAuditSha256) errors.push('Provenance-audit binding mismatch.');
  if (index.evidenceHistorySha256 !== expected.evidenceHistorySha256) errors.push('Evidence-history binding mismatch.');
  if (index.checkpointRef !== expected.checkpointRef) errors.push('Checkpoint-ref binding mismatch.');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function createExternalReviewIndex({ operatorAuditIndex, checkpointIdentity }) {
  const verification = verifyOperatorAuditIndex(operatorAuditIndex, { checkpointRef: checkpointIdentity?.checkpointRef });
  if (!verification.ok) throw new Error(`Operator audit index is invalid: ${verification.errors.join('; ')}`);
  const checkpointRef = requiredText(checkpointIdentity?.checkpointRef, 'checkpointIdentity.checkpointRef');
  if (operatorAuditIndex.checkpointRef !== checkpointRef) throw new Error('Operator audit index and external checkpoint identity reference different checkpoints.');
  const archiveFilename = requiredText(checkpointIdentity?.archiveFilename, 'checkpointIdentity.archiveFilename');
  const sidecarFilename = requiredText(checkpointIdentity?.sidecarFilename, 'checkpointIdentity.sidecarFilename');
  if (!archiveFilename.toLowerCase().endsWith('.zip')) throw new TypeError('archiveFilename must name a ZIP archive.');
  if (!sidecarFilename.endsWith('.checkpoint-manifest.json')) throw new TypeError('sidecarFilename must name a checkpoint manifest JSON file.');

  const identity = Object.freeze({
    checkpointRef,
    archiveFilename,
    archiveSha256: sha(checkpointIdentity.archiveSha256, 'checkpointIdentity.archiveSha256'),
    sidecarFilename,
    sidecarFileSha256: sha(checkpointIdentity.sidecarFileSha256, 'checkpointIdentity.sidecarFileSha256'),
    checkpointManifestSha256: sha(checkpointIdentity.checkpointManifestSha256, 'checkpointIdentity.checkpointManifestSha256'),
    sourceTreeSha256: sha(checkpointIdentity.sourceTreeSha256, 'checkpointIdentity.sourceTreeSha256'),
    dependencyLockSha256: sha(checkpointIdentity.dependencyLockSha256, 'checkpointIdentity.dependencyLockSha256')
  });
  const core = Object.freeze({
    schema: 'omegavault.external-review-index.v1',
    operatorAuditIndex: Object.freeze({
      checkpointRef: operatorAuditIndex.checkpointRef,
      sha256: operatorAuditIndex.sha256,
      provenanceAuditSha256: operatorAuditIndex.provenanceAuditSha256,
      evidenceHistorySha256: operatorAuditIndex.evidenceHistorySha256
    }),
    checkpointIdentity: identity,
    verificationSemantics: Object.freeze({
      archiveIdentity: 'external-sidecar-authority',
      archiveSelfHashEmbedded: false,
      lineageAuthority: operatorAuditIndex.lineageRecovery.authority,
      historyRelation: operatorAuditIndex.evidenceHistory.relationSemantics
    })
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyExternalReviewIndex(index, inputs) {
  const errors = [];
  let expected;
  try { expected = createExternalReviewIndex(inputs); }
  catch (error) { return Object.freeze({ ok: false, errors: Object.freeze([String(error?.message || error)]) }); }
  if (!index || typeof index !== 'object' || Array.isArray(index)) return Object.freeze({ ok: false, errors: Object.freeze(['External review index must be an object.']) });
  if (index.schema !== expected.schema) errors.push('Unexpected external-review index schema.');
  if (index.sha256 !== expected.sha256) errors.push('External-review index digest mismatch.');
  if (evidenceDigest(index.operatorAuditIndex ?? null) !== evidenceDigest(expected.operatorAuditIndex)) errors.push('Operator audit-index reference mismatch.');
  if (evidenceDigest(index.checkpointIdentity ?? null) !== evidenceDigest(expected.checkpointIdentity)) errors.push('External checkpoint identity mismatch.');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
