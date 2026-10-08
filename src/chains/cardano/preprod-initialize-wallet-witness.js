import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from './evidence-binding.js';
import { verifyCardanoPreprodUnsignedInitializePreflight } from './preprod-unsigned-initialize-preflight.js';

function optionalHex(value) {
  return value == null ? null : value.to_hex();
}

function nonVkeyWitnessFingerprint(witnessSet) {
  return Object.freeze({
    nativeScripts: optionalHex(witnessSet.native_scripts()),
    bootstraps: optionalHex(witnessSet.bootstraps()),
    plutusScripts: optionalHex(witnessSet.plutus_scripts()),
    plutusData: optionalHex(witnessSet.plutus_data()),
    redeemers: optionalHex(witnessSet.redeemers())
  });
}

function sameFingerprint(left, right) {
  return Object.keys(left).every(key => left[key] === right[key]);
}

function withoutDigest(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'witnessEvidenceSha256'));
}

export function createCardanoPreprodInitializeWalletWitnessEvidence({
  signedTransactionCborHex,
  unsignedCandidate,
  unsignedPreflight,
  appliedValidatorIdentity,
  utxoBindingEvidence,
  parameters,
  recoveryConfig
}) {
  if (typeof signedTransactionCborHex !== 'string' || !/^[0-9a-f]+$/i.test(signedTransactionCborHex) || signedTransactionCborHex.length % 2 !== 0) {
    throw new TypeError('signedTransactionCborHex must be non-empty base16.');
  }
  if (unsignedCandidate?.evaluation?.mode !== 'live-budget-applied-unsigned-candidate') {
    throw new Error('Wallet witness verification requires the live-budget-applied unsigned initialize candidate.');
  }

  const preflightCheck = verifyCardanoPreprodUnsignedInitializePreflight({
    preflight: unsignedPreflight,
    candidate: unsignedCandidate,
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig
  });
  if (!preflightCheck.valid) {
    throw new Error(`Unsigned initialize preflight verification failed: ${preflightCheck.errors.join('; ')}`);
  }

  const unsignedTx = Cardano.Transaction.from_hex(unsignedCandidate.transaction.cborHex);
  const normalizedSignedTransactionCborHex = signedTransactionCborHex.toLowerCase();
  const signedTx = Cardano.Transaction.from_hex(normalizedSignedTransactionCborHex);
  const canonicalSignedTransactionCborHex = signedTx.to_hex();
  if (canonicalSignedTransactionCborHex !== normalizedSignedTransactionCborHex) {
    throw new Error('Wallet-signed transaction CBOR must round-trip canonically without byte substitution.');
  }

  if (unsignedTx.is_valid() !== true) throw new Error('Frozen unsigned initialize candidate must carry a true transaction validity flag.');
  if (signedTx.is_valid() !== true) throw new Error('Wallet-signed initialize transaction must carry a true transaction validity flag.');

  const unsignedBodyHex = unsignedTx.body().to_hex();
  const signedBodyHex = signedTx.body().to_hex();
  if (signedBodyHex !== unsignedBodyHex) {
    throw new Error('Wallet-signed transaction body differs from the frozen unsigned initialize candidate.');
  }
  if (signedTx.is_valid() !== unsignedTx.is_valid()) {
    throw new Error('Wallet-signed transaction changed the transaction validity flag.');
  }

  const unsignedAux = optionalHex(unsignedTx.auxiliary_data());
  const signedAux = optionalHex(signedTx.auxiliary_data());
  if (signedAux !== unsignedAux) {
    throw new Error('Wallet-signed transaction auxiliary data differs from the frozen unsigned candidate.');
  }

  const unsignedWitnessSet = unsignedTx.witness_set();
  const signedWitnessSet = signedTx.witness_set();
  const unsignedNonVkey = nonVkeyWitnessFingerprint(unsignedWitnessSet);
  const signedNonVkey = nonVkeyWitnessFingerprint(signedWitnessSet);
  if (!sameFingerprint(unsignedNonVkey, signedNonVkey)) {
    throw new Error('Wallet-signed transaction changed non-wallet witness material.');
  }
  if (unsignedWitnessSet.vkeys() != null) {
    throw new Error('Frozen unsigned initialize candidate unexpectedly already contains wallet witnesses.');
  }

  const vkeys = signedWitnessSet.vkeys();
  if (!vkeys || vkeys.len() !== 1) {
    throw new Error('Wallet-signed initialize transaction must contain exactly one VKey witness.');
  }

  const witness = vkeys.get(0);
  const publicKey = witness.vkey().public_key();
  const keyHash = publicKey.hash().to_hex();
  if (keyHash !== unsignedCandidate.ownerPaymentKeyHash) {
    throw new Error('Wallet witness public key does not match the bound owner payment key.');
  }

  const bodyHashBytes = blake2b(signedTx.body().to_bytes(), { dkLen: 32 });
  if (!publicKey.verify(bodyHashBytes, witness.signature())) {
    throw new Error('Wallet witness signature is invalid for the frozen transaction body hash.');
  }

  const bodyHashHex = Buffer.from(bodyHashBytes).toString('hex');
  if (bodyHashHex !== unsignedCandidate.transaction.bodyHash) {
    throw new Error('Wallet witness verification body hash does not match the frozen candidate metadata.');
  }

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-initialize-wallet-witness-evidence.v1',
    network: 'preprod',
    action: 'initialize',
    unsignedCandidateSha256: unsignedCandidate.candidateSha256,
    unsignedPreflightSha256: unsignedPreflight.preflightSha256,
    validatorIdentitySha256: appliedValidatorIdentity.identitySha256,
    utxoBindingEvidenceSha256: utxoBindingEvidence.evidenceSha256,
    transactionBodyHash: bodyHashHex,
    signedTransactionCborHex: normalizedSignedTransactionCborHex,
    signedTransactionSha256: createHash('sha256').update(Buffer.from(normalizedSignedTransactionCborHex, 'hex')).digest('hex'),
    ownerPaymentKeyHash: keyHash,
    witnessCount: 1,
    checks: Object.freeze({
      exactWalletProducedSignedBytesPreserved: true,
      signedTransactionCanonicalRoundTripExact: true,
      exactUnsignedBodyPreserved: true,
      auxiliaryDataPreserved: true,
      nonWalletWitnessesPreserved: true,
      exactOwnerKeyWitnessCount: true,
      ownerPaymentKeyHashMatched: true,
      ownerSignatureCryptographicallyValid: true,
      walletWitnessesValidated: true,
      completePhaseOneValidated: false
    }),
    liveActions: Object.freeze({
      walletSigningPerformed: true,
      transactionSubmissionPerformed: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false
    }),
    nextGate: 'complete-signed-transaction-phase-one-validation-at-current-preprod-ledger-state-before-any-submission',
    authorityBoundary: 'This evidence preserves and hashes the exact wallet-produced signed transaction bytes (hex case normalized only), requires canonical CBOR round-trip without byte substitution, and verifies one already-produced owner wallet witness against the exact frozen initialize body. It does not authorize ChatGPT/OmegaVault to create signatures, does not authorize submission, and does not prove phase-1 validity, inclusion/finality, recovery or support promotion.'
  });

  return Object.freeze({ ...core, witnessEvidenceSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodInitializeWalletWitnessEvidence({
  evidence,
  ...inputs
}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Cardano initialize wallet witness evidence is required.']), recomputedSha256: null });
  }
  const errors = [];
  let recomputed;
  try {
    recomputed = createCardanoPreprodInitializeWalletWitnessEvidence(inputs);
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([error.message]), recomputedSha256: null });
  }
  if (hashCardanoEvidence(withoutDigest(evidence)) !== evidence.witnessEvidenceSha256) {
    errors.push('Cardano initialize wallet witness evidence self-digest mismatch.');
  }
  if (evidence.witnessEvidenceSha256 !== recomputed.witnessEvidenceSha256) {
    errors.push('Cardano initialize wallet witness evidence does not reproduce from the signed transaction and frozen evidence.');
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    recomputedSha256: recomputed.witnessEvidenceSha256
  });
}
