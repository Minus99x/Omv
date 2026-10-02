import { PROMOTION_GATES } from '../chains/maturity.js';
import { EVIDENCE_LEVELS, GATE_MINIMUM_EVIDENCE } from '../chains/capability-contract.js';
import { getNetwork } from '../chains/network-registry.js';
import { validateEvidenceRecord } from '../core/evidence.js';

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
