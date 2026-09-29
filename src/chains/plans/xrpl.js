import { buildXrplSignerListSet } from '../xrpl/signer-list.js';
export { createXrplEscrowRecoveryPlan, createXrplEscrowFinishPlan, evaluateXrplFeature, TOKEN_ESCROW_AMENDMENT_ID } from '../xrpl/escrow.js';
export { encodeAndVerifyXrplMultisign } from '../xrpl/codec.js';

export function createXrplSignerListPlan({ owner, contacts, threshold }) {
  const built = buildXrplSignerListSet({ owner, contacts, quorum: threshold });
  return Object.freeze({
    chainId: 'xrpl', networkRef: 'xrpl:testnet', operation: 'SignerListSet', owner,
    signerQuorum: threshold,
    signerEntries: Object.freeze(contacts.map(account => ({ account, weight: 1 }))),
    transaction: built.transaction,
    securitySemantics: Object.freeze({ thresholdOnChain: true, resettableInactivityOnChain: false, immutableRescueOnChain: false }),
    blockers: Object.freeze([
      'A SignerList authorizes quorum transactions immediately; it does not enforce OmegaVault inactivity.',
      'An account-wide fixed rescue destination is not enforced by native multisigning.'
    ])
  });
}

export { XRPL_RECOVERY_MODES, assessXrplRecoverySemantics, assertXrplProductClaim } from '../xrpl/recovery-semantics.js';
