export const EVM_SPONSORSHIP_MODES = Object.freeze({
  SELF_FUNDED: 'self-funded',
  RELAYER: 'relayer',
  PAYMASTER: 'paymaster'
});

export function sponsorshipPlan({ mode = EVM_SPONSORSHIP_MODES.SELF_FUNDED, signer, feePayer = signer, relayerEndpoint = null }) {
  if (!Object.values(EVM_SPONSORSHIP_MODES).includes(mode)) throw new TypeError('Unsupported EVM sponsorship mode.');
  if (!signer) throw new TypeError('A signer is required.');
  if (mode === EVM_SPONSORSHIP_MODES.SELF_FUNDED && feePayer !== signer) throw new TypeError('Self-funded mode cannot separate signer and fee payer.');
  if (mode === EVM_SPONSORSHIP_MODES.RELAYER && !relayerEndpoint) {
    return Object.freeze({ mode, signer, feePayer, status: 'scaffold', reason: 'Relayer endpoint not configured.' });
  }
  return Object.freeze({ mode, signer, feePayer, relayerEndpoint, status: mode === EVM_SPONSORSHIP_MODES.SELF_FUNDED ? 'available' : 'scaffold' });
}
