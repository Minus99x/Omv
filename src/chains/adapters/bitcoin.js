import { defineAdapter } from '../adapter-interface.js';

export default defineAdapter({
  id: 'bitcoin',
  family: 'utxo',
  name: 'Bitcoin',
  accountModel: 'utxo/script-descriptor',
  transactionModel: 'utxo',
  signingModel: 'psbt/script-signature',
  recoveryMechanism: 'candidate: descriptor/timelock/Taproot policy or pre-authorized PSBT design',
  implementationStage: 'scaffold',
  proofAdapter: false,
  capabilities: [],
  securityNotes: [
    'No account nonce or general-purpose smart contract assumptions',
    'Fee-bumping, UTXO selection, timelocks and replacement behavior require chain-specific tests'
  ],
  validateAccount(account) {
    return typeof account === 'string' && /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,62}$/.test(account);
  }
});
