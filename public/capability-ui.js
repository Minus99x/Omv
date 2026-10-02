const API_SCHEMA = 'omegavault.api.chain-capabilities.v1';
const CATALOG_SCHEMA = 'omegavault.chain-capability-catalog.v1';
const CONTRACT_SCHEMA = 'omegavault.chain-capability-contract.v1';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value) {
  if (!Array.isArray(value) || value.some(item => !text(item))) return null;
  return [...value];
}

function gateRows(contract) {
  if (!contract.gateEvidence || typeof contract.gateEvidence !== 'object' || Array.isArray(contract.gateEvidence)) return null;
  const rows = [];
  for (const [gate, evidence] of Object.entries(contract.gateEvidence)) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
    if (evidence.gate !== gate || typeof evidence.passed !== 'boolean' || typeof evidence.evidenceSufficient !== 'boolean') return null;
    const level = text(evidence.level);
    const minimumEvidence = text(evidence.minimumEvidence);
    const refs = stringArray(evidence.refs);
    if (!level || !minimumEvidence || !refs) return null;
    rows.push(Object.freeze({ gate, passed: evidence.passed, evidenceSufficient: evidence.evidenceSufficient, level, minimumEvidence, refs: Object.freeze(refs) }));
  }
  return Object.freeze(rows.sort((a, b) => a.gate.localeCompare(b.gate)));
}

function contractView(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return null;
  if (contract.schema !== CONTRACT_SCHEMA) return null;
  const chainId = text(contract.chainId);
  const name = text(contract.name);
  const stage = text(contract.stage);
  const adapterImplementationStage = text(contract.adapterImplementationStage);
  const blockers = stringArray(contract.blockers);
  const notes = stringArray(contract.notes);
  const promotion = contract.promotion;
  const gates = gateRows(contract);
  if (!chainId || !name || !stage || !adapterImplementationStage || !blockers || !notes || !gates) return null;
  if (!promotion || typeof promotion !== 'object' || Array.isArray(promotion) || typeof promotion.eligible !== 'boolean') return null;
  const missingGates = stringArray(promotion.missingGates);
  const insufficientEvidenceGates = stringArray(promotion.insufficientEvidenceGates);
  if (!missingGates || !insufficientEvidenceGates) return null;

  const evidenceCounts = {};
  for (const gate of gates) evidenceCounts[gate.level] = (evidenceCounts[gate.level] ?? 0) + 1;

  return Object.freeze({
    chainId,
    name,
    stage,
    adapterImplementationStage,
    promotionEligible: promotion.eligible,
    promotionLabel: promotion.eligible ? 'Promotion eligible' : 'Not promotion eligible',
    blockers: Object.freeze(blockers),
    notes: Object.freeze(notes),
    missingGates: Object.freeze(missingGates),
    insufficientEvidenceGates: Object.freeze(insufficientEvidenceGates),
    gateEvidence: gates,
    evidenceCounts: Object.freeze(evidenceCounts)
  });
}

export function createCapabilityUiModel(envelope) {
  const unavailable = reason => Object.freeze({
    schema: 'omegavault.capability-ui-model.v1',
    available: false,
    reason,
    headline: 'Status unavailable',
    contracts: Object.freeze([])
  });

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return unavailable('Capability response is missing.');
  if (envelope.schema !== API_SCHEMA) return unavailable('Capability API schema is not recognized.');
  if (envelope.validation?.ok !== true) return unavailable('Capability response was not backend-validated.');
  if (envelope.data?.schema !== CATALOG_SCHEMA || !Array.isArray(envelope.data.contracts)) return unavailable('Capability catalog is malformed.');

  const contracts = [];
  for (const contract of envelope.data.contracts) {
    const view = contractView(contract);
    if (!view) return unavailable('One or more capability contracts are malformed.');
    contracts.push(view);
  }
  if (contracts.length === 0) return unavailable('Capability catalog is empty.');
  if (new Set(contracts.map(contract => contract.chainId)).size !== contracts.length) return unavailable('Capability catalog contains duplicate chains.');

  contracts.sort((a, b) => a.name.localeCompare(b.name));
  return Object.freeze({
    schema: 'omegavault.capability-ui-model.v1',
    available: true,
    reason: null,
    headline: 'Backend-validated capability status',
    contracts: Object.freeze(contracts)
  });
}
