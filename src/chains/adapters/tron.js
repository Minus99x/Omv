import { defineAdapter } from '../adapter-interface.js';
export default defineAdapter({
  id: 'tron', family: 'tron', name: 'TRON', accountModel: 'account-with-weighted-permissions', transactionModel: 'tron-contract-transaction', signingModel: 'secp256k1-multisign-permission-id',
  recoveryMechanism: 'exact mode: TVM vault with inactivity-gated threshold and immutable rescue; reduced-semantics alternative: native Account Permission Management', implementationStage: 'scaffold', proofAdapter: false,
  proofNetworks: [{ id: 'tron:shasta', testOnly: true }], capabilities: [],
  securityNotes: ['Native permissions provide weighted threshold authorization but no built-in inactivity timer and are not the exact-semantics path.', 'The TVM vault is offline-compiled and verified but has not been deployed or exercised on Shasta.', 'Every write requires current Energy estimation, a caller-derived fee_limit, and solidified receipt evidence before proof promotion.'],
  validateAccount(account) { return typeof account === 'string' && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(account); }
});
