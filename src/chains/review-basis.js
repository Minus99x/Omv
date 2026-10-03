import { evidenceDigest } from '../core/evidence.js';
import { createProvenanceIntegrityAudit } from './provenance-audit.js';
import { createEvidenceHistoryCatalog } from './evidence-history.js';
import { createEvidenceProvenanceCatalog } from './evidence-provenance.js';

export function createExternalReviewBasis() {
  const audit = createProvenanceIntegrityAudit();
  const history = createEvidenceHistoryCatalog();
  const provenance = createEvidenceProvenanceCatalog();

  const core = Object.freeze({
    schema: 'omegavault.external-review-basis.v1',
    provenanceAudit: Object.freeze({
      schema: audit.schema,
      sha256: audit.sha256,
      lineageStatus: audit.lineageRecovery.status,
      recoveredParentBindingCount: audit.lineageRecovery.recoveredBindingCount
    }),
    evidenceHistory: Object.freeze({
      schema: history.schema,
      sha256: evidenceDigest(history),
      checkpointCount: history.summary.checkpointCount,
      evidenceRefCount: history.summary.evidenceRefCount,
      relationSemantics: history.relationSemantics
    }),
    evidenceProvenance: Object.freeze({
      schema: provenance.schema,
      sha256: evidenceDigest(provenance),
      recordCount: provenance.records.length
    }),
    semantics: Object.freeze({
      promotionAuthority: 'backend-capability-contract-only',
      lineageAuthority: 'explicit-cryptographic-parent-bindings-only',
      externalCheckpointIdentity: 'checkpoint-sidecar-only'
    })
  });

  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyExternalReviewBasis(basis) {
  const errors = [];
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) {
    return Object.freeze({ ok: false, errors: Object.freeze(['Review basis must be an object.']) });
  }
  if (basis.schema !== 'omegavault.external-review-basis.v1') errors.push('Unexpected review-basis schema.');
  let expected;
  try { expected = createExternalReviewBasis(); }
  catch (error) { errors.push(String(error?.message || error)); }
  if (expected && basis.sha256 !== expected.sha256) errors.push('Review basis does not match current backend evidence state.');
  if (typeof basis.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(basis.sha256)) errors.push('Review-basis SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned } = basis;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Review-basis digest mismatch.');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
