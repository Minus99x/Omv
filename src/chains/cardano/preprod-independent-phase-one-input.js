import { createHash } from 'node:crypto';
import { hashCardanoEvidence } from './evidence-binding.js';

const HEX_32 = /^[0-9a-f]{64}$/i;
const HEX_BYTES = /^(?:[0-9a-f]{2})+$/i;
const REQUEST_SCHEMA = 'omegavault.cardano.preprod-independent-phase-one-input.v1';
const REQUIRED_CHECKS = Object.freeze([
  'currentProtocolParametersIndependentlyConfirmed',
  'frozenUnsignedPreflightStillReproduces',
  'walletWitnessEvidenceVerified',
  'exactSignedBodyPreserved',
  'currentProtocolSnapshotBoundAndReproducible',
  'currentProtocolSnapshotStableTipBound',
  'currentProtocolParametersBoundByDigest',
  'signedTransactionSizeWithinCurrentMaximum',
  'signedExecutionUnitsWithinCurrentMaximum',
  'signedFeeCoversCurrentMinimum',
  'outputValueSizesWithinCurrentMaximum',
  'seedStillUnspent',
  'collateralStillUnspent',
  'boundInputValuesUnchanged',
  'boundInputOutputShapeUnchanged',
  'validityIntervalCurrent',
  'preSubmitFreshnessGateComplete'
]);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}
function hex32(value, label) {
  if (typeof value !== 'string' || !HEX_32.test(value)) throw new TypeError(`${label} must be 32-byte hex.`);
  return value.toLowerCase();
}
function bytes(value, label) {
  if (typeof value !== 'string' || !HEX_BYTES.test(value)) throw new TypeError(`${label} must be non-empty even-length base16.`);
  return value.toLowerCase();
}
function assertDigest(value, digestField, label) {
  const document = object(value, label);
  const original = hex32(document[digestField], `${label}.${digestField}`);
  const core = Object.fromEntries(Object.entries(document).filter(([key]) => key !== digestField));
  if (hashCardanoEvidence(core) !== original) throw new Error(`${label} self-digest mismatch.`);
  return original;
}
function assertNoAuthority(value, label) {
  const flags = object(value.liveActions, `${label}.liveActions`);
  for (const field of [
    'transactionSubmissionAuthorized',
    'transactionSubmissionPerformed',
    'liveValueMovementAuthorized',
    'publicNetworkRecoveryProven',
    'supportClaimAuthorized'
  ]) {
    if (flags[field] !== false) throw new Error(`${label} must explicitly deny ${field}.`);
  }
}
function reference(role, label) {
  const item = object(role, label);
  if (item.stillUnspent !== true || item.exactValuePreserved !== true || item.exactOutputShapePreserved !== true) {
    throw new Error(`${label} is not proven unspent and unchanged at the current tip.`);
  }
  const txId = hex32(item.reference?.transaction?.id, `${label}.reference.transaction.id`);
  const index = item.reference?.index;
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError(`${label}.reference.index must be a non-negative safe integer.`);
  const valueSha256 = hex32(item.valueSha256, `${label}.valueSha256`);
  if (typeof item.address !== 'string' || !item.address.startsWith('addr_test1')) throw new Error(`${label}.address must be a Cardano testnet address.`);
  if (typeof item.lovelace !== 'string' || !/^\d+$/.test(item.lovelace)) throw new Error(`${label}.lovelace must be unsigned integer text.`);
  return Object.freeze({
    reference: Object.freeze({ transaction: Object.freeze({ id: txId }), index }),
    address: item.address,
    lovelace: item.lovelace,
    valueSha256,
    datumPresent: item.datumPresent === true,
    referenceScriptPresent: item.referenceScriptPresent === true
  });
}

/**
 * Prepare byte-exact inputs for a future independent Cardano ledger validator.
 * This function NEVER validates phase one, contacts a provider, signs, or submits.
 * Neither an Ogmios evaluateTransaction result nor a self-asserted JSON pass is
 * an independent ledger verdict. Request output cannot authorize submission.
 */
export function createCardanoPreprodIndependentPhaseOneInput({
  witnessEvidence,
  preSubmitEvidence,
  signedTransactionCborHex
}) {
  const witness = object(witnessEvidence, 'witnessEvidence');
  const preSubmit = object(preSubmitEvidence, 'preSubmitEvidence');
  if (witness.schema !== 'omegavault.cardano.preprod-initialize-wallet-witness-evidence.v1' || witness.network !== 'preprod' || witness.action !== 'initialize') {
    throw new Error('Expected a verified Cardano Preprod initialize owner-witness record.');
  }
  if (preSubmit.schema !== 'omegavault.cardano.preprod-initialize-pre-submit-evidence.v2' || preSubmit.network !== 'preprod' || preSubmit.action !== 'initialize') {
    throw new Error('Expected a Cardano Preprod initialize pre-submit freshness record.');
  }
  const witnessDigest = assertDigest(witness, 'witnessEvidenceSha256', 'witnessEvidence');
  const preSubmitDigest = assertDigest(preSubmit, 'preSubmitSha256', 'preSubmitEvidence');
  assertNoAuthority(witness, 'witnessEvidence');
  assertNoAuthority(preSubmit, 'preSubmitEvidence');
  for (const check of [
    'exactWalletProducedSignedBytesPreserved',
    'signedTransactionCanonicalRoundTripExact',
    'exactUnsignedBodyPreserved',
    'auxiliaryDataPreserved',
    'nonWalletWitnessesPreserved',
    'exactOwnerKeyWitnessCount',
    'ownerPaymentKeyHashMatched',
    'ownerSignatureCryptographicallyValid',
    'walletWitnessesValidated'
  ]) {
    if (witness.checks?.[check] !== true) throw new Error(`Owner witness prerequisite ${check} is not true.`);
  }
  if (witness.checks?.completePhaseOneValidated !== false) {
    throw new Error('Owner witness evidence is not at the signed-but-unvalidated boundary.');
  }
  if (preSubmit.checks?.completePhaseOneValidated !== false) {
    throw new Error('Pre-submit evidence must not claim complete phase-one validation.');
  }
  for (const check of REQUIRED_CHECKS) {
    if (preSubmit.checks?.[check] !== true) throw new Error(`Pre-submit prerequisite ${check} is not true.`);
  }
  if (preSubmit.witnessEvidenceSha256 !== witnessDigest) throw new Error('Pre-submit evidence does not bind the supplied owner-witness evidence.');
  if (preSubmit.unsignedCandidateSha256 !== witness.unsignedCandidateSha256 ||
      preSubmit.unsignedPreflightSha256 !== witness.unsignedPreflightSha256 ||
      preSubmit.validatorIdentitySha256 !== witness.validatorIdentitySha256 ||
      preSubmit.utxoBindingEvidenceSha256 !== witness.utxoBindingEvidenceSha256) {
    throw new Error('Pre-submit evidence changed the signed candidate/preflight/validator/UTxO identity.');
  }

  const signedHex = bytes(signedTransactionCborHex, 'signedTransactionCborHex');
  const witnessedHex = bytes(witness.signedTransactionCborHex, 'witnessEvidence.signedTransactionCborHex');
  if (signedHex !== witnessedHex) throw new Error('Independent phase-one input must contain the exact already-witnessed signed transaction bytes.');
  const signedHash = createHash('sha256').update(Buffer.from(signedHex, 'hex')).digest('hex');
  if (signedHash !== hex32(witness.signedTransactionSha256, 'witnessEvidence.signedTransactionSha256') ||
      signedHash !== hex32(preSubmit.signedTransaction?.sha256, 'preSubmitEvidence.signedTransaction.sha256')) {
    throw new Error('Signed transaction digest is inconsistent across witness and live pre-submit evidence.');
  }
  if (signedHex.length / 2 !== preSubmit.signedTransaction?.bytes) throw new Error('Signed transaction byte length no longer matches pre-submit evidence.');
  const bodyHash = hex32(witness.transactionBodyHash, 'witnessEvidence.transactionBodyHash');
  const tip = object(preSubmit.currentTip, 'preSubmitEvidence.currentTip');
  const tipHash = hex32(tip.hash, 'preSubmitEvidence.currentTip.hash');
  if (!Number.isSafeInteger(tip.slot) || tip.slot < 0) throw new Error('Current tip slot must be a non-negative safe integer.');
  const snapshot = object(preSubmit.currentProtocolSnapshot, 'preSubmitEvidence.currentProtocolSnapshot');
  if (hashCardanoEvidence(snapshot) !== hex32(preSubmit.currentProtocolSnapshotSha256, 'preSubmitEvidence.currentProtocolSnapshotSha256')) {
    throw new Error('Current protocol snapshot does not reproduce its pre-submit digest.');
  }
  if (snapshot.schemaVersion !== 2 || String(snapshot.tip?.blockHash).toLowerCase() !== tipHash || snapshot.tip?.slot !== tip.slot ||
      String(snapshot.parameters?.sourceBlockHash).toLowerCase() !== tipHash) {
    throw new Error('Current protocol snapshot is not bound to the recorded stable ledger tip.');
  }
  const lower = preSubmit.validity?.lowerSlot;
  const upper = preSubmit.validity?.upperSlot;
  if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper) || lower > upper || tip.slot < lower || tip.slot > upper || preSubmit.validity?.currentTipWithinInterval !== true) {
    throw new Error('Signed transaction validity interval does not include the captured stable tip.');
  }
  const seed = reference(preSubmit.currentInputs?.seed, 'preSubmitEvidence.currentInputs.seed');
  const collateral = reference(preSubmit.currentInputs?.collateral, 'preSubmitEvidence.currentInputs.collateral');
  if (seed.reference.transaction.id === collateral.reference.transaction.id && seed.reference.index === collateral.reference.index) {
    throw new Error('Seed and collateral must be distinct current UTxOs.');
  }
  const core = Object.freeze({
    schema: REQUEST_SCHEMA,
    network: 'preprod',
    action: 'initialize',
    purpose: 'external-complete-signed-current-ledger-phase-one-validation',
    signedTransaction: Object.freeze({
      cborHex: signedHex,
      sha256: signedHash,
      bodyHash,
      bytes: signedHex.length / 2
    }),
    sources: Object.freeze({
      witnessEvidenceSha256: witnessDigest,
      preSubmitEvidenceSha256: preSubmitDigest,
      unsignedCandidateSha256: hex32(witness.unsignedCandidateSha256, 'witnessEvidence.unsignedCandidateSha256'),
      validatorIdentitySha256: hex32(witness.validatorIdentitySha256, 'witnessEvidence.validatorIdentitySha256'),
      currentProtocolSnapshotSha256: preSubmit.currentProtocolSnapshotSha256,
      currentProtocolParametersSha256: hex32(preSubmit.currentProtocolParametersSha256, 'preSubmitEvidence.currentProtocolParametersSha256')
    }),
    ledgerContext: Object.freeze({
      tip: Object.freeze({ hash: tipHash, slot: tip.slot }),
      protocolSnapshot: snapshot,
      utxos: Object.freeze({ seed, collateral }),
      validity: Object.freeze({ lowerSlot: lower, upperSlot: upper })
    }),
    validationRequirements: Object.freeze({
      independentLedgerImplementationRequired: true,
      exactSignedBytesOnly: true,
      reretrieveAndAnchorFreshLedgerState: true,
      validateAllApplicablePhaseOneRules: true,
      failOnMissingLedgerEvidence: true,
      noOgmiosEvaluationAsPhaseOneSubstitute: true,
      noTransactionRebuild: true,
      noSubmissionOrBroadcast: true
    }),
    completePhaseOneValidated: false,
    transactionSubmissionAuthorized: false,
    transactionSubmissionPerformed: false,
    supportClaimAuthorized: false,
    nextGate: 'external-ledger-validator-integration-not-yet-implemented',
    authorityBoundary: 'This is an input contract, not a validation verdict. It contains only the exact signed transaction and reproducible prior evidence references. An independent implementation must revalidate current ledger state and every applicable phase-one ledger rule; Ogmios execution-budget evaluation alone does not qualify. No signing, transaction submission, funds movement, or support promotion is authorized.'
  });
  return Object.freeze({ ...core, requestSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodIndependentPhaseOneInput({ input, witnessEvidence, preSubmitEvidence, signedTransactionCborHex }) {
  const errors = [];
  try {
    const doc = object(input, 'input');
    const expected = createCardanoPreprodIndependentPhaseOneInput({ witnessEvidence, preSubmitEvidence, signedTransactionCborHex });
    const core = Object.fromEntries(Object.entries(doc).filter(([key]) => key !== 'requestSha256'));
    if (doc.requestSha256 !== hashCardanoEvidence(core)) errors.push('Independent phase-one input self-digest mismatch.');
    if (doc.requestSha256 !== expected.requestSha256) errors.push('Independent phase-one input does not reproduce from its signed/current-ledger evidence.');
  } catch (error) { errors.push(error.message); }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), completePhaseOneValidated: false, transactionSubmissionAuthorized: false });
}
