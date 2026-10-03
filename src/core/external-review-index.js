import { evidenceDigest } from './evidence.js';
import { verifyCheckpointManifest } from './checkpoint-manifest.js';
import { verifyExternalReviewBasis } from '../chains/review-basis.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function sha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return value.toLowerCase();
}

function text(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function validateSidecar(sidecar) {
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) throw new TypeError('checkpointManifest must be an object.');
  if (!sidecar.sourceInventory || sidecar.sourceInventory.schema !== 'omegavault.source-tree-inventory.v1') throw new TypeError('checkpointManifest must include its sourceInventory.');
  const verification = verifyCheckpointManifest(sidecar, {
    checkpoint: sidecar.checkpoint,
    dependencyLock: { schema: 'omegavault.dependency-lock.v1', ...sidecar.dependencyLock },
    sourceInventory: sidecar.sourceInventory,
    proofBundleSha256: sidecar.proofBundleSha256 ?? null
  });
  if (!verification.ok) throw new Error(`Checkpoint manifest is invalid: ${verification.errors.join('; ')}`);
  return sidecar;
}

export function createExternalReviewIndex({ checkpointManifest, checkpointManifestFilename, checkpointManifestFileSha256, reviewBasis }) {
  const sidecar = validateSidecar(checkpointManifest);
  const basisVerification = verifyExternalReviewBasis(reviewBasis);
  if (!basisVerification.ok) throw new Error(`External review basis is invalid: ${basisVerification.errors.join('; ')}`);

  const filename = text(checkpointManifestFilename, 'checkpointManifestFilename');
  if (!filename.endsWith('.checkpoint-manifest.json')) throw new TypeError('checkpointManifestFilename must name a checkpoint manifest JSON file.');

  const core = Object.freeze({
    schema: 'omegavault.external-review-index.v1',
    checkpoint: Object.freeze({
      ref: text(sidecar.checkpoint.ref, 'checkpoint.ref'),
      archiveFilename: text(sidecar.checkpoint.archive, 'checkpoint.archive'),
      archiveSha256: sha(sidecar.checkpoint.archiveSha256, 'checkpoint.archiveSha256')
    }),
    checkpointManifest: Object.freeze({
      filename,
      fileSha256: sha(checkpointManifestFileSha256, 'checkpointManifestFileSha256'),
      logicalSha256: sha(sidecar.sha256, 'checkpointManifest.sha256'),
      sourceTreeSha256: sha(sidecar.sourceTree.sha256, 'checkpointManifest.sourceTree.sha256'),
      dependencyLockSha256: sha(sidecar.dependencyLock.sha256, 'checkpointManifest.dependencyLock.sha256')
    }),
    reviewBasis: Object.freeze({
      schema: reviewBasis.schema,
      sha256: sha(reviewBasis.sha256, 'reviewBasis.sha256'),
      provenanceAuditSha256: sha(reviewBasis.provenanceAudit.sha256, 'reviewBasis.provenanceAudit.sha256'),
      evidenceHistorySha256: sha(reviewBasis.evidenceHistory.sha256, 'reviewBasis.evidenceHistory.sha256'),
      evidenceProvenanceSha256: sha(reviewBasis.evidenceProvenance.sha256, 'reviewBasis.evidenceProvenance.sha256'),
      historyRelationSemantics: text(reviewBasis.evidenceHistory.relationSemantics, 'reviewBasis.evidenceHistory.relationSemantics'),
      lineageStatus: text(reviewBasis.provenanceAudit.lineageStatus, 'reviewBasis.provenanceAudit.lineageStatus')
    }),
    verification: Object.freeze({
      archiveIdentityAuthority: 'external-checkpoint-sidecar',
      auditIdentityAuthority: 'backend-generated-review-basis',
      sourceAncestryInference: false,
      selfReferentialArchiveHashing: false
    })
  });

  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyExternalReviewIndex(index, inputs) {
  const errors = [];
  let expected;
  try { expected = createExternalReviewIndex(inputs); }
  catch (error) { return Object.freeze({ ok: false, errors: Object.freeze([String(error?.message || error)]) }); }

  if (!index || typeof index !== 'object' || Array.isArray(index)) return Object.freeze({ ok: false, errors: Object.freeze(['Review index must be an object.']) });
  if (index.schema !== expected.schema) errors.push('Unexpected external-review index schema.');
  if (index.sha256 !== expected.sha256) errors.push('External-review index digest mismatch.');
  if (evidenceDigest(index.checkpoint ?? null) !== evidenceDigest(expected.checkpoint)) errors.push('Checkpoint identity mismatch.');
  if (evidenceDigest(index.checkpointManifest ?? null) !== evidenceDigest(expected.checkpointManifest)) errors.push('Checkpoint-manifest identity mismatch.');
  if (evidenceDigest(index.reviewBasis ?? null) !== evidenceDigest(expected.reviewBasis)) errors.push('Review-basis identity mismatch.');
  if (evidenceDigest(index.verification ?? null) !== evidenceDigest(expected.verification)) errors.push('Verification-semantics mismatch.');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
