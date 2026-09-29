import { defineAdapter } from '../adapter-interface.js';

export default defineAdapter({
  id: 'solana',
  family: 'solana',
  name: 'Solana',
  accountModel: 'program-account',
  transactionModel: 'recent-blockhash-account-list',
  signingModel: 'ed25519-wallet-adapter',
  recoveryMechanism: 'candidate: audited program + PDA state or smart-wallet integration',
  implementationStage: 'scaffold',
  proofAdapter: false,
  capabilities: [],
  securityNotes: [
    'Program ownership/PDA semantics differ materially from EVM',
    'Blockhash expiry and account-list integrity must be tested explicitly'
  ],
  validateAccount(account) {
    return typeof account === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account);
  }
});
