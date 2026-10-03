import { PROMOTION_GATES } from '../chains/maturity.js';
import { EVIDENCE_LEVELS, GATE_MINIMUM_EVIDENCE } from '../chains/capability-contract.js';
import { getNetwork } from '../chains/network-registry.js';
import { validateEvidenceRecord } from '../core/evidence.js';
import { validateMaturityEvidenceProvenanceCoverage, resolveEvidenceProvenance } from '../chains/evidence-provenance.js';
import { createEvidenceHistoryCatalog } from '../chains/evidence-history.js';
import { createEvidenceDiagnosticsCatalog } from '../chains/evidence-diagnostics.js';
import { verifyProvenanceIntegrityAudit } from '../chains/provenance-audit.js';
import { CURRENT_AUDIT_INDEX_CHECKPOINT, verifyOperatorAuditIndex } from '../chains/operator-audit-index.js';
import { getChainCapabilityContract } from '../chains/capability-catalog.js';

const evidenceRank = new Map(EVIDENCE_LEVELS.map((level, index) => [level, index]));

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object.`);
  return value;
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function stringArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const normalized = value.map((item, index) => requiredText(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} must not contain duplicates.`);
  return normalized;
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function validateGateEvidence(contract, gate) {
  const evidence = plainObject(contract.gateEvidence?.[gate], `contract.gateEvidence.${gate}`);
  if (evidence.gate !== gate) throw new Error(`Gate evidence key mismatch for ${gate}.`);
  if (!EVIDENCE_LEVELS.includes(evidence.level)) throw new Error(`Unknown evidence level for ${gate}: ${evidence.level}`);
  if (evidence.minimumEvidence !== GATE_MINIMUM_EVIDENCE[gate]) throw new Error(`Minimum evidence mismatch for ${gate}.`);
  const refs = stringArray(evidence.refs, `contract.gateEvidence.${gate}.refs`);
  if (evidence.passed === true && refs.length === 0) throw new Error(`${gate} cannot pass without evidence references.`);
  const sufficient = evidence.passed === true && evidenceRank.get(evidence.level) >= evidenceRank.get(evidence.minimumEvidence);
  if (evidence.evidenceSufficient !== sufficient) throw new Error(`Derived evidence sufficiency mismatch for ${gate}.`);
  return { passed: evidence.passed === true, sufficient };
}

export function validateCapabilityContractResponse(contract) {
  plainObject(contract, 'contract');
  if (contract.schema !== 'omegavault.chain-capability-contract.v1') throw new Error('Unexpected capability-contract schema.');
  const chainId = requiredText(contract.chainId, 'contract.chainId');
  requiredText(contract.name, 'contract.name');
  requiredText(contract.adapterImplementationStage, 'contract.adapterImplementationStage');
  requiredText(contract.stage, 'contract.stage');
  stringArray(contract.declaredCapabilities, 'contract.declaredCapabilities');
  const blockers = stringArray(contract.blockers, 'contract.blockers');
  stringArray(contract.notes, 'contract.notes');

  if (!Array.isArray(contract.networks)) throw new TypeError('contract.networks must be an array.');
  for (const [index, network] of contract.networks.entries()) {
    plainObject(network, `contract.networks[${index}]`);
    const networkId = requiredText(network.id, `contract.networks[${index}].id`);
    if (network.chainId !== chainId) throw new Error(`Network ${networkId} is cross-wired to chain ${network.chainId}.`);
    const registered = getNetwork(networkId);
    if (!registered) throw new Error(`Network ${networkId} is not registered.`);
    if (registered.chainId !== chainId) throw new Error(`Registered network ${networkId} belongs to a different chain.`);
    if (registered.environment !== network.environment) throw new Error(`Network environment mismatch for ${networkId}.`);
  }

  const passed = [];
  const sufficient = [];
  for (const gate of PROMOTION_GATES) {
    const result = validateGateEvidence(contract, gate);
    if (result.passed) passed.push(gate);
    if (result.sufficient) sufficient.push(gate);
  }

  const missingGates = PROMOTION_GATES.filter(gate => !passed.includes(gate));
  const insufficientEvidenceGates = PROMOTION_GATES.filter(gate => passed.includes(gate) && !sufficient.includes(gate));
  const derivedEligible = missingGates.length === 0 && insufficientEvidenceGates.length === 0 && blockers.length === 0;
  const promotion = plainObject(contract.promotion, 'contract.promotion');
  if (promotion.totalGates !== PROMOTION_GATES.length) throw new Error('Promotion total-gate count mismatch.');
  if (promotion.passedGates !== passed.length) throw new Error('Promotion passed-gate count mismatch.');
  if (promotion.sufficientEvidenceGates !== sufficient.length) throw new Error('Promotion sufficient-evidence count mismatch.');
  if (!sameSet(stringArray(promotion.missingGates, 'contract.promotion.missingGates'), missingGates)) throw new Error('Promotion missing-gate set mismatch.');
  if (!sameSet(stringArray(promotion.insufficientEvidenceGates, 'contract.promotion.insufficientEvidenceGates'), insufficientEvidenceGates)) throw new Error('Promotion insufficient-evidence set mismatch.');
  if (promotion.eligible !== derivedEligible) throw new Error('Promotion eligibility does not match evidence and blockers.');

  return Object.freeze({ ok: true, chainId, promotionEligible: derivedEligible });
}

export function validateCapabilityCatalogResponse(catalog) {
  plainObject(catalog, 'catalog');
  if (catalog.schema !== 'omegavault.chain-capability-catalog.v1') throw new Error('Unexpected capability-catalog schema.');
  if (!Array.isArray(catalog.contracts)) throw new TypeError('catalog.contracts must be an array.');
  const chainIds = [];
  for (const contract of catalog.contracts) {
    const validation = validateCapabilityContractResponse(contract);
    chainIds.push(validation.chainId);
  }
  if (new Set(chainIds).size !== chainIds.length) throw new Error('Capability catalog contains duplicate chain IDs.');
  return Object.freeze({ ok: true, chainCount: chainIds.length, chainIds: Object.freeze(chainIds) });
}

export function createValidatedCapabilityCatalogResponse(catalog) {
  const validation = validateCapabilityCatalogResponse(catalog);
  return Object.freeze({
    schema: 'omegavault.api.chain-capabilities.v1',
    data: catalog,
    validation
  });
}

export function validateEvidenceApiPayload(record) {
  const validation = validateEvidenceRecord(record);
  if (!validation.ok) throw new Error(`Invalid evidence record: ${validation.errors.join('; ')}`);
  const network = getNetwork(record.networkRef);
  if (!network) throw new Error(`Evidence references unregistered network ${record.networkRef}.`);
  if (network.chainId !== record.chainId) throw new Error(`Evidence network ${record.networkRef} belongs to ${network.chainId}, not ${record.chainId}.`);
  return Object.freeze({ ok: true, chainId: record.chainId, networkRef: record.networkRef });
}

export function createValidatedEvidenceApiResponse(record) {
  const validation = validateEvidenceApiPayload(record);
  return Object.freeze({
    schema: 'omegavault.api.evidence.v1',
    data: record,
    validation
  });
}


export function validateEvidenceProvenanceCatalogResponse(catalog) {
  plainObject(catalog, 'provenanceCatalog');
  if (catalog.schema !== 'omegavault.evidence-provenance-catalog.v1') throw new Error('Unexpected evidence-provenance catalog schema.');
  if (!Array.isArray(catalog.records)) throw new TypeError('provenanceCatalog.records must be an array.');
  const refs = [];
  for (const [index, item] of catalog.records.entries()) {
    plainObject(item, `provenanceCatalog.records[${index}]`);
    const ref = requiredText(item.ref, `provenanceCatalog.records[${index}].ref`);
    const match = ref.match(/^(0\.6\.\d+):([A-Z0-9_]+)$/);
    if (!match) throw new Error(`Invalid provenance ref ${ref}.`);
    if (item.checkpointRef !== `${match[1]}-dev`) throw new Error(`Checkpoint ref mismatch for ${ref}.`);
    if (item.archiveFilename !== `omegavault-mvp-${match[1]}-dev.zip`) throw new Error(`Archive filename mismatch for ${ref}.`);
    if (typeof item.archiveSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(item.archiveSha256)) throw new Error(`Archive SHA-256 is invalid for ${ref}.`);
    if (item.parentBundleSha256 != null && (typeof item.parentBundleSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(item.parentBundleSha256))) throw new Error(`Parent bundle SHA-256 is invalid for ${ref}.`);
    const chainIds = stringArray(item.chainIds, `provenanceCatalog.records[${index}].chainIds`);
    const artifactPaths = stringArray(item.artifactPaths, `provenanceCatalog.records[${index}].artifactPaths`);
    if (chainIds.length < 1) throw new Error(`Provenance record ${ref} must name at least one chain.`);
    if (artifactPaths.length < 1 || artifactPaths.some(path => path.startsWith('/') || path.includes('..'))) throw new Error(`Unsafe artifact path in provenance record ${ref}.`);
    requiredText(item.scope, `provenanceCatalog.records[${index}].scope`);
    requiredText(item.summary, `provenanceCatalog.records[${index}].summary`);
    refs.push(ref);
  }
  if (new Set(refs).size !== refs.length) throw new Error('Evidence provenance catalog contains duplicate refs.');
  const coverage = validateMaturityEvidenceProvenanceCoverage();
  if (!coverage.ok) throw new Error(`Maturity evidence provenance coverage failed: ${coverage.errors.join('; ')}`);
  return Object.freeze({ ok: true, recordCount: refs.length, refs: Object.freeze(refs) });
}

export function createValidatedEvidenceProvenanceCatalogResponse(catalog) {
  const validation = validateEvidenceProvenanceCatalogResponse(catalog);
  return Object.freeze({
    schema: 'omegavault.api.evidence-provenance.v1',
    data: catalog,
    validation
  });
}


export function validateEvidenceHistoryCatalogResponse(catalog) {
  plainObject(catalog, 'historyCatalog');
  if (catalog.schema !== 'omegavault.evidence-history-catalog.v1') throw new Error('Unexpected evidence-history catalog schema.');
  if (catalog.relationSemantics !== 'evidence-checkpoint-order-not-source-ancestry') throw new Error('Unexpected evidence-history relation semantics.');
  if (!Array.isArray(catalog.checkpoints) || catalog.checkpoints.length < 1) throw new TypeError('historyCatalog.checkpoints must be a non-empty array.');
  const checkpointRefs = [];
  let refCount = 0;
  for (const [index, item] of catalog.checkpoints.entries()) {
    plainObject(item, `historyCatalog.checkpoints[${index}]`);
    const checkpointRef = requiredText(item.checkpointRef, `historyCatalog.checkpoints[${index}].checkpointRef`);
    const match = checkpointRef.match(/^0\.6\.(\d+)-dev$/);
    if (!match) throw new Error(`Invalid evidence-history checkpoint ref ${checkpointRef}.`);
    if (item.versionNumber !== Number(match[1])) throw new Error(`Version number mismatch for ${checkpointRef}.`);
    if (item.archiveFilename !== `omegavault-mvp-0.6.${match[1]}-dev.zip`) throw new Error(`Archive filename mismatch for ${checkpointRef}.`);
    if (typeof item.archiveSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(item.archiveSha256)) throw new Error(`Archive SHA-256 is invalid for ${checkpointRef}.`);
    const refs = stringArray(item.evidenceRefs, `historyCatalog.checkpoints[${index}].evidenceRefs`);
    const chainIds = stringArray(item.chainIds, `historyCatalog.checkpoints[${index}].chainIds`);
    const scopes = stringArray(item.scopes, `historyCatalog.checkpoints[${index}].scopes`);
    const artifacts = stringArray(item.artifactPaths, `historyCatalog.checkpoints[${index}].artifactPaths`);
    stringArray(item.summaries, `historyCatalog.checkpoints[${index}].summaries`);
    if (!refs.length || !chainIds.length || !scopes.length || !artifacts.length) throw new Error(`Evidence-history checkpoint ${checkpointRef} is incomplete.`);
    if (artifacts.some(path => path.startsWith('/') || path.includes('..'))) throw new Error(`Unsafe artifact path in evidence-history checkpoint ${checkpointRef}.`);
    if (item.relationSemantics !== catalog.relationSemantics) throw new Error(`Relation semantics mismatch for ${checkpointRef}.`);
    for (const ref of refs) {
      const provenance = resolveEvidenceProvenance(ref);
      if (!provenance) throw new Error(`Evidence-history checkpoint ${checkpointRef} references unregistered provenance ${ref}.`);
      if (provenance.checkpointRef !== checkpointRef || provenance.archiveFilename !== item.archiveFilename || provenance.archiveSha256 !== item.archiveSha256) throw new Error(`Evidence-history checkpoint provenance drift for ${ref}.`);
      if (provenance.chainIds.some(chainId => !chainIds.includes(chainId))) throw new Error(`Evidence-history chain coverage mismatch for ${ref}.`);
      refCount += 1;
    }
    checkpointRefs.push(checkpointRef);
  }
  if (new Set(checkpointRefs).size !== checkpointRefs.length) throw new Error('Evidence-history catalog contains duplicate checkpoints.');
  for (let index = 0; index < catalog.checkpoints.length; index += 1) {
    const item = catalog.checkpoints[index];
    const expectedPrevious = index > 0 ? catalog.checkpoints[index - 1].checkpointRef : null;
    const expectedNext = index < catalog.checkpoints.length - 1 ? catalog.checkpoints[index + 1].checkpointRef : null;
    if ((item.previousEvidenceCheckpointRef ?? null) !== expectedPrevious) throw new Error(`Previous evidence checkpoint mismatch for ${item.checkpointRef}.`);
    if ((item.nextEvidenceCheckpointRef ?? null) !== expectedNext) throw new Error(`Next evidence checkpoint mismatch for ${item.checkpointRef}.`);
  }
  plainObject(catalog.summary, 'historyCatalog.summary');
  if (catalog.summary.checkpointCount !== catalog.checkpoints.length || catalog.summary.evidenceRefCount !== refCount) throw new Error('Evidence-history summary counts do not match checkpoint data.');
  if (catalog.summary.earliestCheckpointRef !== catalog.checkpoints[0].checkpointRef || catalog.summary.latestCheckpointRef !== catalog.checkpoints.at(-1).checkpointRef) throw new Error('Evidence-history summary boundary refs do not match checkpoint data.');
  return Object.freeze({ ok: true, checkpointCount: catalog.checkpoints.length, evidenceRefCount: refCount });
}

export function createValidatedEvidenceHistoryCatalogResponse(catalog = createEvidenceHistoryCatalog()) {
  const validation = validateEvidenceHistoryCatalogResponse(catalog);
  return Object.freeze({ schema: 'omegavault.api.evidence-history.v1', data: catalog, validation });
}


export function validateEvidenceDiagnosticsCatalogResponse(catalog) {
  plainObject(catalog, 'diagnosticsCatalog');
  if (catalog.schema !== 'omegavault.evidence-diagnostics-catalog.v1') throw new Error('Unexpected evidence-diagnostics catalog schema.');
  if (catalog.lineageSemantics !== 'cryptographic-parent-bindings-only') throw new Error('Unexpected evidence-diagnostics lineage semantics.');
  if (!Array.isArray(catalog.diagnostics) || catalog.diagnostics.length < 1) throw new TypeError('diagnosticsCatalog.diagnostics must be a non-empty array.');
  const chainIds=[];
  for (const [index,item] of catalog.diagnostics.entries()) {
    plainObject(item, `diagnosticsCatalog.diagnostics[${index}]`);
    const chainId=requiredText(item.chainId, `diagnosticsCatalog.diagnostics[${index}].chainId`);
    const contract=getChainCapabilityContract(chainId);
    if (!contract) throw new Error(`Diagnostics reference unknown chain ${chainId}.`);
    if (item.name!==contract.name) throw new Error(`Diagnostics name mismatch for ${chainId}.`);
    if (item.promotionEligible!==contract.promotion.eligible) throw new Error(`Diagnostics promotion state mismatch for ${chainId}.`);
    const missing=stringArray(item.missingGates, `diagnosticsCatalog.diagnostics[${index}].missingGates`);
    const insufficient=stringArray(item.insufficientEvidenceGates, `diagnosticsCatalog.diagnostics[${index}].insufficientEvidenceGates`);
    const blockers=stringArray(item.blockers, `diagnosticsCatalog.diagnostics[${index}].blockers`);
    if (!sameSet(missing, contract.promotion.missingGates)) throw new Error(`Diagnostics missing-gate mismatch for ${chainId}.`);
    if (!sameSet(insufficient, contract.promotion.insufficientEvidenceGates)) throw new Error(`Diagnostics insufficient-evidence mismatch for ${chainId}.`);
    if (!sameSet(blockers, contract.blockers)) throw new Error(`Diagnostics blocker mismatch for ${chainId}.`);
    const unresolved=stringArray(item.unresolvedEvidenceRefs, `diagnosticsCatalog.diagnostics[${index}].unresolvedEvidenceRefs`);
    const crossWired=stringArray(item.crossWiredEvidenceRefs, `diagnosticsCatalog.diagnostics[${index}].crossWiredEvidenceRefs`);
    if (item.provenanceHealthy !== (unresolved.length===0 && crossWired.length===0)) throw new Error(`Diagnostics provenance-health mismatch for ${chainId}.`);
    const expectedSeverity=!item.provenanceHealthy?'error':item.promotionEligible?'clear':'gaps-present';
    if (item.severity!==expectedSeverity) throw new Error(`Diagnostics severity mismatch for ${chainId}.`);
    plainObject(item.explicitLineage, `diagnosticsCatalog.diagnostics[${index}].explicitLineage`);
    if (item.explicitLineage.semantics!==catalog.lineageSemantics) throw new Error(`Diagnostics lineage semantics mismatch for ${chainId}.`);
    if (!['complete','partial','not-recorded'].includes(item.explicitLineage.status)) throw new Error(`Unknown lineage status for ${chainId}.`);
    const lineageRefs=stringArray(item.explicitLineage.refs, `diagnosticsCatalog.diagnostics[${index}].explicitLineage.refs`);
    if (item.explicitLineage.recordedRefCount!==lineageRefs.length) throw new Error(`Diagnostics lineage count mismatch for ${chainId}.`);
    for (const ref of lineageRefs) {
      const provenance = resolveEvidenceProvenance(ref);
      if (!provenance || !provenance.chainIds.includes(chainId) || typeof provenance.parentBundleSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(provenance.parentBundleSha256)) {
        throw new Error(`Diagnostics lineage ref ${ref} lacks an explicit cryptographic parent binding for ${chainId}.`);
      }
    }
    const expectedLineageStatus = lineageRefs.length === 0 ? 'not-recorded' : lineageRefs.length === item.evidenceRefCount && item.evidenceRefCount > 0 ? 'complete' : 'partial';
    if (item.explicitLineage.status !== expectedLineageStatus) throw new Error(`Diagnostics lineage status mismatch for ${chainId}.`);
    requiredText(item.explicitLineage.note, `diagnosticsCatalog.diagnostics[${index}].explicitLineage.note`);
    chainIds.push(chainId);
  }
  if (new Set(chainIds).size!==chainIds.length) throw new Error('Evidence diagnostics catalog contains duplicate chains.');
  plainObject(catalog.summary,'diagnosticsCatalog.summary');
  if (catalog.summary.chainCount!==catalog.diagnostics.length) throw new Error('Evidence diagnostics summary chain count mismatch.');
  return Object.freeze({ok:true,chainCount:chainIds.length,chainIds:Object.freeze(chainIds)});
}

export function createValidatedEvidenceDiagnosticsCatalogResponse(catalog = createEvidenceDiagnosticsCatalog()) {
  const validation=validateEvidenceDiagnosticsCatalogResponse(catalog);
  return Object.freeze({schema:'omegavault.api.evidence-diagnostics.v1',data:catalog,validation});
}


export function validateProvenanceIntegrityAuditResponse(audit) {
  plainObject(audit, 'provenanceAudit');
  const verification = verifyProvenanceIntegrityAudit(audit);
  if (!verification.ok) throw new Error(`Invalid provenance-integrity audit: ${verification.errors.join('; ')}`);
  plainObject(audit.inventory, 'provenanceAudit.inventory');
  plainObject(audit.integrity, 'provenanceAudit.integrity');
  plainObject(audit.lineageRecovery, 'provenanceAudit.lineageRecovery');
  if (!['not-recorded','partial','complete'].includes(audit.lineageRecovery.status)) throw new Error('Unknown lineage recovery status.');
  if (!Array.isArray(audit.lineageRecovery.recovered) || !Array.isArray(audit.lineageRecovery.unrecordedRefs)) throw new TypeError('Lineage recovery arrays are required.');
  if (audit.lineageRecovery.recoveredBindingCount !== audit.lineageRecovery.recovered.length) throw new Error('Recovered lineage count mismatch.');
  if (audit.lineageRecovery.unrecordedRefCount !== audit.lineageRecovery.unrecordedRefs.length) throw new Error('Unrecorded lineage count mismatch.');
  return Object.freeze({ ok: true, sha256: audit.sha256, lineageStatus: audit.lineageRecovery.status });
}

export function createValidatedProvenanceIntegrityAuditResponse(audit) {
  const validation = validateProvenanceIntegrityAuditResponse(audit);
  return Object.freeze({ schema: 'omegavault.api.provenance-integrity-audit.v1', data: audit, validation });
}


export function validateOperatorAuditIndexResponse(index) {
  plainObject(index, 'operatorAuditIndex');
  if (index.schema !== 'omegavault.operator-audit-index.v1') throw new Error('Unexpected operator audit-index schema.');
  if (index.checkpointRef !== CURRENT_AUDIT_INDEX_CHECKPOINT) throw new Error('Operator audit index checkpoint does not match the active review-index checkpoint.');
  const verification = verifyOperatorAuditIndex(index, { checkpointRef: CURRENT_AUDIT_INDEX_CHECKPOINT });
  if (!verification.ok) throw new Error(`Invalid operator audit index: ${verification.errors.join('; ')}`);
  if (index.externalCheckpointIdentity !== 'attached-after-archive-seal') throw new Error('Operator audit index external-checkpoint identity semantics are invalid.');
  return Object.freeze({ ok: true, checkpointRef: index.checkpointRef, sha256: index.sha256 });
}

export function createValidatedOperatorAuditIndexResponse(index) {
  const validation = validateOperatorAuditIndexResponse(index);
  return Object.freeze({ schema: 'omegavault.api.operator-audit-index.v1', data: index, validation });
}
