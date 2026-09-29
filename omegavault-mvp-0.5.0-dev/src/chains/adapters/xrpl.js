import { defineAdapter } from '../adapter-interface.js';

export default defineAdapter({
  id: 'xrpl',
  family: 'xrpl',
  name: 'XRP Ledger',
  accountModel: 'account',
  transactionModel: 'sequence-account',
  signingModel: 'xrpl-signature/multisign-capable',
  recoveryMechanism: 'candidate: native signer-list / account configuration / guarded transaction flow',
  implementationStage: 'scaffold',
  proofAdapter: false,
  capabilities: [],
  securityNotes: [
    'Do not emulate EVM contracts on XRPL',
    'Final mechanism must preserve owner liveness and threshold semantics without custody'
  ],
  validateAccount(account) {
    return typeof account === 'string' && /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account);
  }
});
