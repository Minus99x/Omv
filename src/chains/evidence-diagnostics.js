import { listChainCapabilityContracts } from './capability-catalog.js';
import { resolveEvidenceProvenance } from './evidence-provenance.js';

function unique(values) { return Object.freeze([...new Set(values)]); }

function diagnosticFor(contract) {
  const refs = unique(Object.values(contract.gateEvidence ?? {}).flatMap(evidence => evidence.refs ?? []));
  const resolved = [];
  const unresolved = [];
  const crossWired = [];
  const explicitParentBindings = [];
  for (const ref of refs) {
    const provenance = resolveEvidenceProvenance(ref);
    if (!provenance) { unresolved.push(ref); continue; }
    if (!provenance.chainIds.includes(contract.chainId)) { crossWired.push(ref); continue; }
    resolved.push(ref);
    if (typeof provenance.parentBundleSha256 === 'string' && /^[0-9a-f]{64}$/i.test(provenance.parentBundleSha256)) explicitParentBindings.push(ref);
  }
  const missingGates = Object.freeze([...contract.promotion.missingGates]);
  const insufficientEvidenceGates = Object.freeze([...contract.promotion.insufficientEvidenceGates]);
  const blockers = Object.freeze([...contract.blockers]);
  const lineageStatus = refs.length > 0 && explicitParentBindings.length === refs.length
    ? 'complete'
    : explicitParentBindings.length > 0 ? 'partial' : 'not-recorded';
  const provenanceHealthy = unresolved.length === 0 && crossWired.length === 0;
  const severity = !provenanceHealthy ? 'error' : contract.promotion.eligible ? 'clear' : 'gaps-present';
  return Object.freeze({
    chainId: contract.chainId,
    name: contract.name,
    promotionEligible: contract.promotion.eligible,
    severity,
    evidenceRefCount: refs.length,
    resolvedEvidenceRefCount: resolved.length,
    unresolvedEvidenceRefs: Object.freeze(unresolved),
    crossWiredEvidenceRefs: Object.freeze(crossWired),
    missingGates,
    insufficientEvidenceGates,
    blockers,
    provenanceHealthy,
    explicitLineage: Object.freeze({
      status: lineageStatus,
      semantics: 'cryptographic-parent-bindings-only',
      recordedRefCount: explicitParentBindings.length,
      refs: Object.freeze(explicitParentBindings),
      note: lineageStatus === 'not-recorded'
        ? 'No explicit cryptographic parent binding is recorded; version or timeline order is not treated as ancestry.'
        : 'Only explicit cryptographic parent bindings are counted as lineage.'
    })
  });
}

export function createEvidenceDiagnosticsCatalog() {
  const diagnostics = Object.freeze(listChainCapabilityContracts().map(diagnosticFor).sort((a,b)=>a.name.localeCompare(b.name)));
  return Object.freeze({
    schema: 'omegavault.evidence-diagnostics-catalog.v1',
    lineageSemantics: 'cryptographic-parent-bindings-only',
    summary: Object.freeze({
      chainCount: diagnostics.length,
      healthyProvenanceCount: diagnostics.filter(item => item.provenanceHealthy).length,
      errorCount: diagnostics.filter(item => item.severity === 'error').length,
      gapCount: diagnostics.filter(item => item.severity === 'gaps-present').length,
      promotionEligibleCount: diagnostics.filter(item => item.promotionEligible).length,
      explicitLineageCompleteCount: diagnostics.filter(item => item.explicitLineage.status === 'complete').length
    }),
    diagnostics
  });
}
