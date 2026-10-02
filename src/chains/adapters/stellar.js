import { defineAdapter } from '../adapter-interface.js';
import { isValidStellarEd25519PublicKey } from '../stellar/strkey.js';
export default defineAdapter({
  id: 'stellar', family: 'stellar', name: 'Stellar', accountModel: 'sequence-account-with-signers', transactionModel: 'xdr-sequence-preconditions', signingModel: 'ed25519-extra-signers/preauth-tx/fee-bump',
  recoveryMechanism: 'candidate: exact N-of-N (one or two contacts) pre-authorized recovery transaction + extra signers + minimum sequence age; Soroban fallback for broader M-of-N semantics', implementationStage: 'scaffold', proofAdapter: false,
  proofNetworks: [{ id: 'stellar:testnet', testOnly: true }], capabilities: [],
  securityNotes: ['Pre-authorized transaction hashes bind exact recovery actions.', 'Minimum sequence age can express inactivity relative to the source account sequence age.', 'The exact native path requires N-of-N approval with at most two transaction extra signers; broader M-of-N uses Soroban.', 'A failed applied transaction consumes the matching preAuthTx signer and must not be blindly retried.'],
  validateAccount(account) { return isValidStellarEd25519PublicKey(account); }
});
