export const PROMOTION_GATES = Object.freeze([
  'network-profile', 'address-validation', 'wallet-signing', 'transaction-preflight', 'mechanism-create', 'mechanism-verify',
  'inactivity-semantics', 'threshold-semantics', 'immutable-rescue-semantics', 'native-asset-recovery', 'token-recovery',
  'fee-finality-model', 'adversarial-tests', 'evidence-export', 'threat-review'
]);

export function createMaturityRecord({ chainId, stage = 'scaffold', gates = {} }) {
  if (!chainId) throw new TypeError('chainId is required.');
  const normalized = {};
  for (const gate of PROMOTION_GATES) normalized[gate] = gates[gate] === true;
  return Object.freeze({ chainId, stage, gates: Object.freeze(normalized), completed: Object.values(normalized).filter(Boolean).length, total: PROMOTION_GATES.length });
}

export function canPromoteToLiveProof(record) {
  return PROMOTION_GATES.every(gate => record?.gates?.[gate] === true);
}

export function missingPromotionGates(record) {
  return PROMOTION_GATES.filter(gate => record?.gates?.[gate] !== true);
}
