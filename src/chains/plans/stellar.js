import { StrKey } from '@stellar/stellar-sdk';

function assertAccount(address, label) {
  if (typeof address !== 'string' || !StrKey.isValidEd25519PublicKey(address)) throw new TypeError(`${label} is not a valid Stellar account.`);
}

export function createStellarRecoveryBlueprint({ vaultAccount, rescueDestination, contacts, threshold, inactivitySeconds, recoverySequence }) {
  assertAccount(vaultAccount, 'vaultAccount'); assertAccount(rescueDestination, 'rescueDestination');
  if (!Array.isArray(contacts) || contacts.length < 1 || contacts.length > 2) throw new TypeError('Exact native Stellar recovery requires one or two contact accounts.');
  contacts.forEach(contact => assertAccount(contact, 'contact'));
  if (new Set(contacts).size !== contacts.length) throw new TypeError('Stellar contacts must be unique.');
  if (!Number.isInteger(threshold) || threshold !== contacts.length) throw new TypeError('Exact native Stellar recovery is N-of-N; use the Soroban path for broader M-of-N policies.');
  if (!Number.isInteger(inactivitySeconds) || inactivitySeconds < 1) throw new TypeError('inactivitySeconds must be positive.');
  const seq = BigInt(recoverySequence);
  if (seq <= 0n) throw new TypeError('recoverySequence must be positive.');
  return Object.freeze({
    chainId: 'stellar', networkRef: 'stellar:testnet', strategy: 'preauth-min-sequence-age', vaultAccount, rescueDestination,
    contacts: Object.freeze([...contacts]), threshold, inactivitySeconds, recoverySequence: seq.toString(),
    setup: Object.freeze([
      'Build one exact recovery transaction envelope with the fixed rescue operation(s), a future-safe sequence strategy and minAccountSequenceAge.',
      'Put every contact in the envelope extraSigners precondition, hash that exact transaction, and add the hash as a preAuthTx account signer.',
      'Use ordinary owner-authorized activity/heartbeat to touch the vault account sequence so minAccountSequenceAge resets.',
      'Use fee-bump sponsorship so a separate account can pay inclusion fees without changing the inner recovery authorization.'
    ]),
    requiredProofs: Object.freeze(['preauth hash matches exact envelope', 'every configured extra signer is required', 'extra signatures fail closed', 'too-early submission fails', 'owner activity resets sequence age', 'eligible submission succeeds', 'preauth signer removed after application', 'rescue receives full intended assets', 'fee-bump payer cannot alter inner transaction']),
    nativeScope: 'Exact N-of-N approval with one or two contacts; broader M-of-N requires Soroban.'
  });
}


export function createStellarThresholdPolicy({ contactCount, threshold }) {
  if (!Number.isInteger(contactCount) || contactCount < 1 || contactCount > 2) throw new TypeError('contactCount must be 1-2 for exact native Stellar recovery.');
  if (!Number.isInteger(threshold) || threshold !== contactCount) throw new TypeError('Exact native Stellar recovery is N-of-N.');
  return Object.freeze({
    masterKeyWeight: 1,
    lowThreshold: 1,
    mediumThreshold: 1,
    highThreshold: 1,
    contactAccountSignerWeight: 0,
    requiredExtraSignerCount: contactCount,
    preAuthTransactionWeight: 1,
    recoveryRequirement: `all ${threshold} contact signature(s) as transaction extraSigners + the matching pre-authorized transaction`,
    arbitraryContactSpendBlocked: true,
    rationale: 'Contacts are not account signers. Their signatures are required only by the exact hashed envelope, while the preAuthTx signer authorizes that envelope and no other transaction.'
  });
}
