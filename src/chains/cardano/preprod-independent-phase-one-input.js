import { createHash } from 'node:crypto';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
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
  'completeCurrentInputValuesPreserved',
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
function sameReference(left, right) {
  return left?.transaction?.id === right?.transaction?.id && left?.index === right?.index;
}
function fullLedgerUtxo(record, commitment, label) {
  const full = object(record, label);
  const expected = object(commitment, `${label}.commitment`);
  if (!sameReference(full.reference, expected.reference)) throw new Error(`${label} reference changed from live freshness evidence.`);
  if (full.address !== expected.address) throw new Error(`${label} address changed from live freshness evidence.`);
  if (full.datum != null || full.datumHash != null || full.script != null || expected.datumPresent || expected.referenceScriptPresent) {
    throw new Error(`${label} is not a datum-free, reference-script-free initialization input.`);
  }
  const value = object(full.value, `${label}.value`);
  const assets = Object.keys(value).filter(key => key !== 'ada');
  if (assets.length || String(value.ada?.lovelace ?? '') !== expected.lovelace ||
      hashCardanoEvidence(value) !== expected.valueSha256) {
    throw new Error(`${label} full UTxO value does not match frozen live input commitment.`);
  }
  return Object.freeze({
    reference: expected.reference,
    address: expected.address,
    value,
    datumHash: null,
    datum: null,
    script: null
  });
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
  if (preSubmit.schema !== 'omegavault.cardano.preprod-initialize-pre-submit-evidence.v3' || preSubmit.network !== 'preprod' || preSubmit.action !== 'initialize') {
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
  // Reparse the exact signed bytes and independently derive the transaction
  // body hash. Evidence digests are integrity commitments, not proof that
  // the supplied body hash is correct for the CBOR they describe.
  let signedTransaction;
  try {
    signedTransaction = Cardano.Transaction.from_hex(signedHex);
  } catch {
    throw new Error('Signed transaction CBOR cannot be decoded for independent phase-one input.');
  }
  if (signedTransaction.to_hex().toLowerCase() !== signedHex) {
    throw new Error('Signed transaction CBOR is not an exact canonical round trip.');
  }
  const bodyHash = Buffer.from(blake2b(signedTransaction.body().to_bytes(), { dkLen: 32 })).toString('hex');
  if (bodyHash !== hex32(witness.transactionBodyHash, 'witnessEvidence.transactionBodyHash')) {
    throw new Error('Signed transaction body hash does not match witnessed CBOR.');
  }
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
  // The upper Cardano invalidHereafter slot is EXCLUSIVE. Reject malformed
  // bounds, including empty windows, before preparing any signed-body input.
  if (!Number.isSafeInteger(lower) || lower < 0 ||
      !Number.isSafeInteger(upper) || upper <= lower ||
      tip.slot < lower || tip.slot >= upper ||
      preSubmit.validity?.currentTipWithinInterval !== true) {
    throw new Error('Signed transaction validity interval does not include the captured stable tip.');
  }
  const seed = reference(preSubmit.currentInputs?.seed, 'preSubmitEvidence.currentInputs.seed');
  const collateral = reference(preSubmit.currentInputs?.collateral, 'preSubmitEvidence.currentInputs.collateral');
  if (seed.reference.transaction.id === collateral.reference.transaction.id && seed.reference.index === collateral.reference.index) {
    throw new Error('Seed and collateral must be distinct current UTxOs.');
  }
  // Compare the signed ledger input references and Cardano's half-open slot
  // interval directly with the fresh UTxO/validity commitments. Matching
  // document digests alone cannot prove those describe the signed body.
  const signedBody = signedTransaction.body();
  const frozenBodyHex = bytes(
    preSubmit.unsignedTransactionBodyCborHex,
    'preSubmitEvidence.unsignedTransactionBodyCborHex'
  );
  if (signedBody.to_hex().toLowerCase() !== frozenBodyHex) {
    throw new Error('Signed initialize body does not match the frozen pre-submit transaction body.');
  }
  const unsupportedBodyFields = [
    ['reference inputs', signedBody.reference_inputs()],
    ['certificates', signedBody.certs()],
    ['withdrawals', signedBody.withdrawals()],
    ['update', signedBody.update()],
    ['voting procedures', signedBody.voting_procedures()],
    ['voting proposals', signedBody.voting_proposals()],
    ['current treasury value', signedBody.current_treasury_value()],
    ['donation', signedBody.donation()],
    ['auxiliary data hash', signedBody.auxiliary_data_hash()]
  ];
  const unsupportedBodyField = unsupportedBodyFields.find(([, value]) => value != null);
  if (unsupportedBodyField) {
    throw new Error(`Signed initialize transaction contains unsupported ${unsupportedBodyField[0]}.`);
  }
  if (signedTransaction.auxiliary_data() != null) {
    throw new Error('Signed initialize transaction contains unsupported auxiliary data.');
  }
  const signedInputs = signedBody.inputs();
  const signedCollateral = signedBody.collateral();
  const inputMatches = (input, expected) =>
    input.transaction_id().to_hex() === expected.reference.transaction.id &&
    Number(input.index()) === expected.reference.index;
  if (signedInputs.len() !== 1 || !inputMatches(signedInputs.get(0), seed)) {
    throw new Error('Signed initialize seed input does not match the current ledger UTxO commitment.');
  }
  if (signedCollateral?.len() !== 1 || !inputMatches(signedCollateral.get(0), collateral)) {
    throw new Error('Signed initialize collateral input does not match the current ledger UTxO commitment.');
  }
  if (signedBody.validity_start_interval_bignum()?.to_str() !== String(lower) ||
      signedBody.ttl_bignum()?.to_str() !== String(upper)) {
    throw new Error('Signed initialize validity slots do not match the current pre-submit commitment.');
  }
  if (signedTransaction.is_valid() !== true ||
      signedBody.network_id()?.kind() !== Cardano.NetworkId.testnet().kind()) {
    throw new Error('Signed initialize transaction has invalid validity flag or network id.');
  }
  // Verify the *actual* owner witness, required signer and funding address,
  // not merely the earlier witness evidence's self-asserted boolean flags.
  // This is a local cryptographic/integrity check, NOT complete phase one.
  const vkeys = signedTransaction.witness_set().vkeys();
  if (!vkeys || vkeys.len() !== 1 || witness.witnessCount !== 1) {
    throw new Error('Signed initialize requires exactly one owner VKey witness.');
  }
  const ownerWitness = vkeys.get(0);
  const ownerPublicKey = ownerWitness.vkey().public_key();
  const ownerKeyHash = ownerPublicKey.hash().to_hex();
  if (ownerKeyHash !== witness.ownerPaymentKeyHash) {
    throw new Error('Signed initialize owner VKey does not match recorded owner payment key.');
  }
  if (!ownerPublicKey.verify(blake2b(signedBody.to_bytes(), { dkLen: 32 }), ownerWitness.signature())) {
    throw new Error('Signed initialize owner VKey signature is not valid for its transaction body.');
  }
  const requiredSigners = signedBody.required_signers();
  if (requiredSigners?.len() !== 1 || requiredSigners.get(0).to_hex() !== ownerKeyHash) {
    throw new Error('Signed initialize required signer does not match the verified owner VKey.');
  }
  let fundingAddress;
  try {
    fundingAddress = Cardano.Address.from_bech32(seed.address);
  } catch {
    throw new Error('Initialize seed must have a valid Cardano Preprod payment-key address.');
  }
  const paymentCredential = Cardano.BaseAddress.from_address(fundingAddress)?.payment_cred() ??
    Cardano.EnterpriseAddress.from_address(fundingAddress)?.payment_cred() ??
    Cardano.PointerAddress.from_address(fundingAddress)?.payment_cred();
  if (fundingAddress.network_id() !== 0 || paymentCredential?.to_keyhash()?.to_hex() !== ownerKeyHash) {
    throw new Error('Initialize seed payment credential must match the verified owner VKey on Preprod.');
  }
  // The previous pre-submit check records fee and output balances. Derive
  // those same ADA conservation facts from the *signed CBOR* and fresh,
  // independently captured plain ADA-only UTxOs before handing it to a
  // separate complete Conway phase-one validator.
  const outputs = signedBody.outputs();
  if (outputs.len() !== 2) {
    throw new Error('Signed initialize must have exactly the vault state and wallet change outputs.');
  }
  const stateOutput = outputs.get(0);
  const changeOutput = outputs.get(1);
  if (changeOutput.address().to_bech32() !== seed.address ||
      changeOutput.amount().multiasset() != null) {
    throw new Error('Signed initialize change must return ADA-only to the bound seed wallet.');
  }
  const feeLovelace = signedBody.fee().to_str();
  const declaredFee = preSubmit.signedTransaction?.feeLovelace;
  const currentMinimumFee = preSubmit.signedTransaction?.currentMinimumFeeLovelace;
  if (feeLovelace !== declaredFee || typeof currentMinimumFee !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(currentMinimumFee) || currentMinimumFee.length > 20 ||
      BigInt(feeLovelace) < BigInt(currentMinimumFee)) {
    throw new Error('Signed initialize fee does not match its current pre-submit fee commitment.');
  }
  if (seed.lovelace.length > 20 ||
      BigInt(seed.lovelace) !== BigInt(stateOutput.amount().coin().to_str()) +
        BigInt(changeOutput.amount().coin().to_str()) + BigInt(feeLovelace)) {
    throw new Error('Signed initialize seed ADA conservation failed.');
  }
  const collateralReturn = signedBody.collateral_return();
  const totalCollateral = signedBody.total_collateral();
  if (!collateralReturn || !totalCollateral ||
      collateralReturn.address().to_bech32() !== collateral.address ||
      collateralReturn.amount().multiasset() != null) {
    throw new Error('Signed initialize collateral return must return ADA-only to the bound collateral wallet.');
  }
  if (collateral.lovelace.length > 20 ||
      BigInt(collateral.lovelace) !== BigInt(totalCollateral.to_str()) +
        BigInt(collateralReturn.amount().coin().to_str())) {
    throw new Error('Signed initialize collateral ADA conservation failed.');
  }
  const ledgerSnapshot = object(preSubmit.ledgerInputSnapshot, 'preSubmitEvidence.ledgerInputSnapshot');
  const ledgerSnapshotDigest = hex32(preSubmit.ledgerInputSnapshotSha256, 'preSubmitEvidence.ledgerInputSnapshotSha256');
  if (hashCardanoEvidence(ledgerSnapshot) !== ledgerSnapshotDigest) {
    throw new Error('Full current ledger input snapshot does not match its bound digest.');
  }
  if (ledgerSnapshot.source !== 'read-only-ogmios-queryLedgerState/utxo' ||
      ledgerSnapshot.tip?.hash !== tipHash || ledgerSnapshot.tip?.slot !== tip.slot) {
    throw new Error('Full current ledger input snapshot was not captured at the bound stable tip.');
  }
  const fullSeed = fullLedgerUtxo(ledgerSnapshot.utxos?.seed, seed, 'ledgerInputSnapshot.seed');
  const fullCollateral = fullLedgerUtxo(ledgerSnapshot.utxos?.collateral, collateral, 'ledgerInputSnapshot.collateral');
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
      currentProtocolParametersSha256: hex32(preSubmit.currentProtocolParametersSha256, 'preSubmitEvidence.currentProtocolParametersSha256'),
      ledgerInputSnapshotSha256: ledgerSnapshotDigest
    }),
    ledgerContext: Object.freeze({
      tip: Object.freeze({ hash: tipHash, slot: tip.slot }),
      protocolSnapshot: snapshot,
      utxoCommitments: Object.freeze({ seed, collateral }),
      utxos: Object.freeze({ seed: fullSeed, collateral: fullCollateral }),
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
