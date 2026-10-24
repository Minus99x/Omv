export const PROMOTION_GATES = Object.freeze([
  'network-profile', 'address-validation', 'wallet-signing', 'transaction-preflight', 'mechanism-create', 'mechanism-verify',
  'inactivity-semantics', 'threshold-semantics', 'immutable-rescue-semantics', 'native-asset-recovery', 'token-recovery',
  'fee-finality-model', 'adversarial-tests', 'evidence-export', 'threat-review'
]);

export function createMaturityRecord({ chainId, stage = 'scaffold', gates = {} }) {
  if (typeof chainId !== 'string' || !chainId.trim()) throw new TypeError('chainId is required.');
  if (!['planned','scaffold','live-proof'].includes(stage)) throw new TypeError('Unknown chain maturity stage.');
  if (!gates || typeof gates !== 'object' || Array.isArray(gates)) throw new TypeError('Maturity gates must be an object.');
  const normalized = {};
  for (const gate of PROMOTION_GATES) normalized[gate] = Object.hasOwn(gates,gate) && gates[gate] === true;
  return Object.freeze({ chainId, stage, gates: Object.freeze(normalized), completed: Object.values(normalized).filter(Boolean).length, total: PROMOTION_GATES.length });
}

export function canPromoteToLiveProof(record) {
  if (!record || typeof record.chainId !== 'string' || !record.chainId.trim() ||
      !['planned','scaffold','live-proof'].includes(record.stage) ||
      !record.gates || typeof record.gates !== 'object' || Array.isArray(record.gates)) return false;
  return PROMOTION_GATES.every(gate => Object.hasOwn(record.gates,gate) && record.gates[gate] === true);
}

export function missingPromotionGates(record) {
  return PROMOTION_GATES.filter(gate => record?.gates?.[gate] !== true);
}
