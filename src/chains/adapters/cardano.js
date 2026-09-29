import { defineAdapter } from '../adapter-interface.js';
export default defineAdapter({
  id: 'cardano', family: 'eutxo', name: 'Cardano', accountModel: 'eutxo/address-script', transactionModel: 'eutxo', signingModel: 'ed25519/native-script-or-plutus',
  recoveryMechanism: 'candidate: native signature + timelock script or Plutus vault, with recovery transaction policy designed around UTXO state', implementationStage: 'scaffold', proofAdapter: false,
  proofNetworks: [{ id: 'cardano:preprod', testOnly: true }], capabilities: [],
  securityNotes: ['Native scripts can combine signature and timelock rules but UTXO destination/control semantics must be proven.', 'Plutus adds collateral/execution-budget considerations.'],
  validateAccount(account) { return typeof account === 'string' && /^(addr|addr_test)1[0-9a-z]{20,120}$/.test(account); }
});
