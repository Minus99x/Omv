export const XRPL_RECOVERY_MODES = Object.freeze({
  FIXED_TIME_ESCROW: 'fixed-time-escrow',
  SIGNER_QUORUM: 'signer-quorum',
  RESETTABLE_INACTIVITY: 'resettable-inactivity'
});

export function assessXrplRecoverySemantics({ mode, token = false } = {}) {
  if (!Object.values(XRPL_RECOVERY_MODES).includes(mode)) throw new TypeError('Unknown XRPL recovery mode.');
  if (mode === XRPL_RECOVERY_MODES.FIXED_TIME_ESCROW) return Object.freeze({
    mode, native: true, exactResettableInactivity: false,
    mechanism: 'EscrowCreate/FinishAfter',
    tokenEscrowCapabilityRequired: Boolean(token),
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
  if (claim === 'resettable-inactivity' && !assessment.exactResettableInactivity) {
    throw new TypeError(`XRPL ${mode} must not be advertised as resettable inactivity recovery.`);
  }
  return true;
}
