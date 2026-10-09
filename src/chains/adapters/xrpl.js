import { defineAdapter } from '../adapter-interface.js';

export default defineAdapter({
  id: 'xrpl',
  family: 'xrpl',
  name: 'XRP Ledger',
  accountModel: 'account',
  transactionModel: 'sequence-account',
  signingModel: 'xrpl-signature/multisign-capable',
  recoveryMechanism: 'invariant-first native composition under evaluation; exact OmegaVault recovery not yet established',
  implementationStage: 'scaffold',
  proofAdapter: false,
  capabilities: [],
  securityNotes: [
    'Do not emulate EVM contracts on XRPL; compose XRPL-native primitives against the canonical invariants',
    'SignerList provides threshold authorization but not an inactivity clock or immutable rescue intent',
    'Escrow provides fixed-time immutable destination/scope but not resettable inactivity or trusted-contact quorum',
    'Permission Delegation, Tickets and Batch narrow authority/sequence/atomicity but do not independently close the remaining recovery gaps',
    'Hooks-family programmable research is separate from XRPL mainnet support claims'
  ],
  validateAccount(account) {
    return typeof account === 'string' && /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account);
  }
});
