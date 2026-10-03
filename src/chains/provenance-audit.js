import { evidenceDigest } from '../core/evidence.js';
import { listChainCapabilityContracts } from './capability-catalog.js';
import { createEvidenceProvenanceCatalog, validateMaturityEvidenceProvenanceCoverage } from './evidence-provenance.js';
import { createEvidenceHistoryCatalog } from './evidence-history.js';
import { createEvidenceDiagnosticsCatalog } from './evidence-diagnostics.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function sorted(values) {
  return Object.freeze([...values].sort((a, b) => String(a).localeCompare(String(b))));
}

function explicitLineageRecords(records) {
  return Object.freeze(records
    .filter(record => typeof record.parentBundleSha256 === 'string' && SHA256.test(record.parentBundleSha256))
    .map(record => Object.freeze({
      ref: record.ref,
      checkpointRef: record.checkpointRef,
      chainIds: Object.freeze([...record.chainIds]),
      parentBundleSha256: record.parentBundleSha256.toLowerCase()
    }))
    .sort((a, b) => a.ref.localeCompare(b.ref)));
}

export function createProvenanceIntegrityAudit() {
  const capabilityContracts = listChainCapabilityContracts();
  const provenance = createEvidenceProvenanceCatalog();
  const history = createEvidenceHistoryCatalog();
  const diagnostics = createEvidenceDiagnosticsCatalog();
  const coverage = validateMaturityEvidenceProvenanceCoverage();
  if (!coverage.ok) throw new Error(`Cannot create provenance audit with invalid maturity coverage: ${coverage.errors.join('; ')}`);

  const explicitLineage = explicitLineageRecords(provenance.records);
  const unrecordedLineageRefs = sorted(provenance.records
    .filter(record => record.parentBundleSha256 == null)
    .map(record => record.ref));

  const core = Object.freeze({
    schema: 'omegavault.provenance-integrity-audit.v1',
    semantics: Object.freeze({
      promotionAuthority: 'backend-capability-contract-only',
      lineageAuthority: 'explicit-cryptographic-parent-bindings-only',
      historyRelation: history.relationSemantics
    }),
    inventory: Object.freeze({
      chainCount: capabilityContracts.length,
      provenanceRecordCount: provenance.records.length,
      evidenceCheckpointCount: history.checkpoints.length,
      diagnosticsChainCount: diagnostics.diagnostics.length
    }),
    integrity: Object.freeze({
      maturityCoverageOk: coverage.ok,
      provenanceHealthyChainCount: diagnostics.summary.healthyProvenanceCount,
      provenanceErrorCount: diagnostics.summary.errorCount,
      evidenceGapChainCount: diagnostics.summary.gapCount,
      promotionEligibleChainCount: diagnostics.summary.promotionEligibleCount
    }),
    lineageRecovery: Object.freeze({
      status: explicitLineage.length === 0 ? 'not-recorded' : unrecordedLineageRefs.length === 0 ? 'complete' : 'partial',
      recoveredBindingCount: explicitLineage.length,
      unrecordedRefCount: unrecordedLineageRefs.length,
      recovered: explicitLineage,
      unrecordedRefs: unrecordedLineageRefs,
      note: explicitLineage.length === 0
        ? 'No existing provenance record contains an explicit cryptographic parent-bundle digest. No lineage is inferred from checkpoint/version order.'
        : 'Only provenance records carrying an explicit parent-bundle SHA-256 are counted as recovered lineage.'
    }),
    chains: Object.freeze(diagnostics.diagnostics.map(item => Object.freeze({
      chainId: item.chainId,
      name: item.name,
      promotionEligible: item.promotionEligible,
      provenanceHealthy: item.provenanceHealthy,
      severity: item.severity,
      evidenceRefCount: item.evidenceRefCount,
      missingGateCount: item.missingGates.length,
      insufficientEvidenceGateCount: item.insufficientEvidenceGates.length,
      blockerCount: item.blockers.length,
      explicitLineageStatus: item.explicitLineage.status
    })))
  });

  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyProvenanceIntegrityAudit(audit) {
  const errors = [];
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return Object.freeze({ ok: false, errors: Object.freeze(['Audit must be an object.']) });
  if (audit.schema !== 'omegavault.provenance-integrity-audit.v1') errors.push('Unexpected provenance-integrity audit schema.');
  if (typeof audit.sha256 !== 'string' || !SHA256.test(audit.sha256)) errors.push('Audit SHA-256 is invalid.');
  else {
    const { sha256, ...unsigned } = audit;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Audit digest mismatch.');
  }
  let expected;
  try { expected = createProvenanceIntegrityAudit(); }
  catch (error) { errors.push(String(error?.message || error)); }
  if (expected && audit.sha256 !== expected.sha256) errors.push('Audit does not match current backend provenance state.');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
