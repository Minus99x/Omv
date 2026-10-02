import { PROMOTION_GATES } from '../chains/maturity.js';
import { EVIDENCE_LEVELS, GATE_MINIMUM_EVIDENCE } from '../chains/capability-contract.js';
import { getNetwork } from '../chains/network-registry.js';
import { validateEvidenceRecord } from '../core/evidence.js';
import { validateMaturityEvidenceProvenanceCoverage } from '../chains/evidence-provenance.js';

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
  return Object.freeze({ schema: 'omegavault.api.chain-capabilities.v1', data: catalog, validation });
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
  return Object.freeze({ schema: 'omegavault.api.evidence.v1', data: record, validation });
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
