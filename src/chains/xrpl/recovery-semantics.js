export const XRPL_RECOVERY_MODES = Object.freeze({
  FIXED_TIME_ESCROW: 'fixed-time-escrow',
  SIGNER_QUORUM: 'signer-quorum',
  RESETTABLE_INACTIVITY: 'resettable-inactivity'
});

export function assessXrplRecoverySemantics({ mode, token = false } = {}) {
  if (!Object.values(XRPL_RECOVERY_MODES).includes(mode)) throw new TypeError('Unknown XRPL recovery mode.');
  if(typeof token!=='boolean')throw new TypeError('XRPL token flag must be a primitive boolean.');
  if (mode === XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW) return Object.freeze({
    mode, native: true, exactResettableInactivity: false,
    mechanism: 'EscrowCreate/FinishAfter',
    tokenEscrowCapabilityRequired: token,
    reason: 'FinishAfter and CancelAfter are immutable absolute Ripple-epoch times; heartbeat activity cannot move an existing escrow maturity.'
  });
  if (mode === XRPL_RECOVERY_MODES.SIGNER_QUORUM) return Object.freeze({
    mode, native: true, exactResettableInactivity: false,
    mechanism: 'SignerListSet/multisign', tokenEscrowCapabilityRequired: false,
    reason: 'Signer lists authorize transactions but do not provide an inactivity clock.'
  });
  return Object.freeze({
    mode, native: false, exactResettableInactivity: false,
    mechanism: null, tokenEscrowCapabilityRequired: false,
    reason: 'No verified native XRPL primitive in the current connector provides an owner-resettable inactivity deadline with immutable rescue semantics.'
  });
}

export function assertXrplProductClaim({ mode, claim }) {
  const assessment = assessXrplRecoverySemantics({ mode });
  // An unknown claim must never be treated as proof of an unimplemented
  // recovery capability simply because it is not named resettable-inactivity.
  if (typeof claim !== 'string' || !Object.values(XRPL_RECOVERY_MODES).includes(claim)) {
    throw new TypeError('Unknown XRPL recovery product claim.');
  }
  if (claim === 'resettable-inactivity' && !assessment.exactResettableInactivity) {
    throw new TypeError(`XRPL ${mode} must not be advertised as resettable inactivity recovery.`);
  }
  if (claim !== mode) throw new TypeError('XRPL product claim does not match the verified recovery mode.');
  return true;
}
