import { PROMOTION_GATES } from './maturity.js';

export const EVIDENCE_LEVELS = Object.freeze(['none', 'source', 'offline-test', 'public-testnet']);

const evidenceRank = new Map(EVIDENCE_LEVELS.map((level, index) => [level, index]));

export const GATE_MINIMUM_EVIDENCE = Object.freeze({
  'network-profile': 'source',
  'address-validation': 'offline-test',
  'wallet-signing': 'public-testnet',
  'transaction-preflight': 'offline-test',
  'mechanism-create': 'public-testnet',
  'mechanism-verify': 'public-testnet',
  'inactivity-semantics': 'public-testnet',
  'threshold-semantics': 'public-testnet',
  'immutable-rescue-semantics': 'public-testnet',
  'native-asset-recovery': 'public-testnet',
  'token-recovery': 'public-testnet',
  'fee-finality-model': 'public-testnet',
  'adversarial-tests': 'offline-test',
  'evidence-export': 'offline-test',
  'threat-review': 'source'
});

export const CONTRACT_STAGES = Object.freeze([
  'catalogued', 'scaffold', 'source-verified', 'offline-verified', 'compatibility-ready',
  'legacy-live-proof', 'live-proof', 'reduced-semantics', 'parked', 'blocked'
]);

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function normalizeRefs(refs, label) {
  if (refs == null) return Object.freeze([]);
  if (!Array.isArray(refs)) throw new TypeError(`${label} must be an array.`);
  const values = refs.map((value, index) => requiredText(value, `${label}[${index}]`));
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must not contain duplicates.`);
  return Object.freeze(values);
}

function normalizeGateEvidence(gate, input = {}) {
  const minimumEvidence = GATE_MINIMUM_EVIDENCE[gate];
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError(`Gate ${gate} evidence must be a record object.`);
  const level = input.level ?? 'none';
  if (!evidenceRank.has(level)) throw new TypeError(`Unknown evidence level for ${gate}: ${level}`);
  const refs = normalizeRefs(input.refs, `gateEvidence.${gate}.refs`);
  const passed = input.passed === true;
  if (passed && level === 'none') throw new TypeError(`${gate} cannot pass without an evidence level.`);
  if (passed && refs.length === 0) throw new TypeError(`${gate} cannot pass without at least one evidence reference.`);
  const evidenceSufficient = passed && evidenceRank.get(level) >= evidenceRank.get(minimumEvidence);
  return Object.freeze({ gate, passed, level, minimumEvidence, evidenceSufficient, refs });
}

function normalizeNetwork(network) {
  return Object.freeze({
    id: requiredText(network?.id, 'network.id'),
    chainId: requiredText(network?.chainId, 'network.chainId'),
    name: requiredText(network?.name, 'network.name'),
    environment: requiredText(network?.environment, 'network.environment'),
    implementationStage: requiredText(network?.implementationStage, 'network.implementationStage')
  });
}

export function createCapabilityMaturityContract({ adapter, networks = [], stage = 'scaffold', gateEvidence = {}, blockers = [], notes = [] }) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter is required.');
  const chainId = requiredText(adapter.id, 'adapter.id');
  if (!CONTRACT_STAGES.includes(stage)) throw new TypeError(`Unknown capability-contract stage: ${stage}`);
  if (!Array.isArray(networks)) throw new TypeError('networks must be an array.');
  if (!gateEvidence || typeof gateEvidence!=='object' || Array.isArray(gateEvidence))
    throw new TypeError('gateEvidence must be an object.');
  const normalizedNetworks = Object.freeze(networks.map(network => {
    const normalized = normalizeNetwork(network);
    if (normalized.chainId !== chainId) throw new TypeError(`Network ${normalized.id} does not belong to adapter ${chainId}.`);
    return normalized;
  }));
  const normalizedGates = Object.freeze(Object.fromEntries(PROMOTION_GATES.map(gate => [gate,
    normalizeGateEvidence(gate, Object.hasOwn(gateEvidence,gate) ? gateEvidence[gate] : {})])));
  const blockerList = normalizeRefs(blockers, 'blockers');
  const noteList = normalizeRefs(notes, 'notes');
  const missingGates = Object.freeze(PROMOTION_GATES.filter(gate => !normalizedGates[gate].passed));
  const insufficientEvidenceGates = Object.freeze(PROMOTION_GATES.filter(gate => normalizedGates[gate].passed && !normalizedGates[gate].evidenceSufficient));
  const promotionEligible = missingGates.length === 0 && insufficientEvidenceGates.length === 0 && blockerList.length === 0;

  return Object.freeze({
    schema: 'omegavault.chain-capability-contract.v1',
    chainId,
    name: requiredText(adapter.name, 'adapter.name'),
    adapterImplementationStage: requiredText(adapter.implementationStage, 'adapter.implementationStage'),
    stage,
    declaredCapabilities: Object.freeze([...(adapter.capabilities ?? [])]),
    networks: normalizedNetworks,
    promotion: Object.freeze({
      eligible: promotionEligible,
      totalGates: PROMOTION_GATES.length,
      passedGates: PROMOTION_GATES.filter(gate => normalizedGates[gate].passed).length,
      sufficientEvidenceGates: PROMOTION_GATES.filter(gate => normalizedGates[gate].evidenceSufficient).length,
      missingGates,
      insufficientEvidenceGates
    }),
    gateEvidence: normalizedGates,
    blockers: blockerList,
    notes: noteList
  });
}
