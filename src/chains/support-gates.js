import { CORE_INVARIANT_IDS } from '../core/invariants.js';

export const SUPPORT_EVIDENCE_LEVEL = 'public-testnet';

function normalizeEvidenceRecord(id, value, chainId) {
  const refs = Array.isArray(value?.refs) ? value.refs.filter(ref => typeof ref === 'string' && ref.trim()) : [];
  const chainScoped = Boolean(chainId && value?.chainId === chainId);
  const passed = value?.passed === true;
  const level = value?.level ?? 'none';
  const sufficient = passed && level === SUPPORT_EVIDENCE_LEVEL && refs.length > 0 && chainScoped;
  return Object.freeze({
    invariantId: id,
    passed,
    level,
    refs: Object.freeze([...refs]),
    chainScoped,
    sufficient
  });
}

export function evaluateChainSupport({ capabilityContract, invariantEvidence = {} }) {
  const chainId = capabilityContract?.chainId ?? null;
  const evidence = Object.freeze(Object.fromEntries(
    CORE_INVARIANT_IDS.map(id => [id, normalizeEvidenceRecord(id, invariantEvidence[id], chainId)])
  ));

  const promotionEligible = capabilityContract?.promotion?.eligible === true;
  const noBlockers = Array.isArray(capabilityContract?.blockers) && capabilityContract.blockers.length === 0;
  const insufficientInvariants = Object.freeze(
    CORE_INVARIANT_IDS.filter(id => evidence[id].sufficient !== true)
  );
  const reasons = [];
  if (!chainId) reasons.push('Missing capability contract.');
  if (!promotionEligible) reasons.push('Capability promotion gates are not fully eligible.');
  if (!noBlockers) reasons.push('Capability contract still has blockers.');
  if (insufficientInvariants.length) reasons.push('Core invariant public-testnet evidence is incomplete.');

  return Object.freeze({
    schema: 'omegavault.chain-support-gate.v1',
    chainId,
    supported: reasons.length === 0,
    requiredEvidenceLevel: SUPPORT_EVIDENCE_LEVEL,
    promotionEligible,
    noBlockers,
    insufficientInvariants,
    evidence,
    reasons: Object.freeze(reasons)
  });
}
