import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from './evidence-binding.js';
import {
  calculateCardanoMinimumFee,
  calculateCardanoRequiredCollateral
} from './protocol-parameters.js';
import { calculateCardanoMinRequiredLovelace } from './recovery-validator.js';
import { verifyCardanoPreprodRealInitializeCandidate } from './preprod-real-initialize.js';

function inputRef(input) {
  return Object.freeze({
    transaction: Object.freeze({ id: input.transaction_id().to_hex() }),
    index: Number(input.index())
  });
}

function sameRef(left, right) {
  return left?.transaction?.id === right?.transaction?.id && left?.index === right?.index;
}

function minAdaCheck(output, parameters, label) {
  const requirement = calculateCardanoMinRequiredLovelace({
    serializedOutputBytes: output.to_bytes().length,
    coinsPerUtxoByte: parameters.coinsPerUtxoByte
  });
  const actual = output.amount().coin().to_str();
  if (BigInt(actual) < BigInt(requirement.minimumLovelace)) {
    throw new Error(`${label} is below current minimum ADA.`);
  }
  return Object.freeze({
    outputBytes: output.to_bytes().length,
    actualLovelace: actual,
    minimumLovelace: requirement.minimumLovelace,
    satisfied: true
  });
}

function valueSizeCheck(output, parameters, label) {
  if (parameters.maxValueSize == null) {
    return Object.freeze({
      serializedValueBytes: output.amount().to_bytes().length,
      maxValueSize: null,
      parameterAvailable: false,
      satisfied: false
    });
  }
  if (!Number.isSafeInteger(parameters.maxValueSize) || parameters.maxValueSize < 1) {
    throw new TypeError('maxValueSize must be a positive safe integer when present.');
  }
  const serializedValueBytes = output.amount().to_bytes().length;
  if (serializedValueBytes > parameters.maxValueSize) {
    throw new Error(`${label} serialized value exceeds current maxValueSize.`);
  }
  return Object.freeze({
    serializedValueBytes,
    maxValueSize: parameters.maxValueSize,
    parameterAvailable: true,
    satisfied: true
  });
}

export function createCardanoPreprodUnsignedInitializePreflight({
  candidate,
  appliedValidatorIdentity,
  utxoBindingEvidence,
  parameters,
  recoveryConfig
}) {
  if (candidate?.evaluation?.mode !== 'live-budget-applied-unsigned-candidate') {
    throw new Error('Unsigned phase-one preflight requires the live-budget-applied initialize candidate.');
  }
  const mintBudget = candidate.evaluation?.mintBudget;
  const candidateCheck = verifyCardanoPreprodRealInitializeCandidate({
    candidate,
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: false,
    mintBudget
  });
  if (!candidateCheck.valid) {
    throw new Error(`Cardano real initialize candidate verification failed: ${candidateCheck.errors.join('; ')}`);
  }

  const tx = Cardano.Transaction.from_hex(candidate.transaction.cborHex);
  const body = tx.body();
  if (tx.is_valid() !== true) throw new Error('Unsigned initialize candidate must carry a true transaction validity flag.');
  if (tx.witness_set().vkeys() != null) throw new Error('Unsigned initialize preflight must not contain wallet key witnesses.');
  if (body.inputs().len() !== 1) throw new Error('Unsigned initialize preflight requires exactly one seed input.');
  if (body.collateral()?.len() !== 1) throw new Error('Unsigned initialize preflight requires exactly one collateral input.');
  if (body.outputs().len() !== 2) throw new Error('Unsigned initialize preflight requires exactly state + wallet change outputs.');

  const seedRef = inputRef(body.inputs().get(0));
  const collateralRef = inputRef(body.collateral().get(0));
  if (!sameRef(seedRef, utxoBindingEvidence.roles.seed.reference)) throw new Error('Unsigned initialize seed input is not the bound real Preprod seed UTxO.');
  if (!sameRef(collateralRef, utxoBindingEvidence.roles.collateral.reference)) throw new Error('Unsigned initialize collateral input is not the bound real Preprod collateral UTxO.');

  const bodyHash = Buffer.from(blake2b(body.to_bytes(), { dkLen: 32 })).toString('hex');
  if (bodyHash !== candidate.transaction.bodyHash) throw new Error('Unsigned initialize body hash does not match candidate metadata.');
  if (body.fee().to_str() !== candidate.transaction.feeLovelace) throw new Error('Unsigned initialize body fee does not match candidate metadata.');
  if (body.validity_start_interval_bignum()?.to_str() !== String(candidate.validity.lowerSlot)) throw new Error('Unsigned initialize lower validity slot mismatch.');
  if (body.ttl_bignum()?.to_str() !== String(candidate.validity.upperSlot)) throw new Error('Unsigned initialize upper validity slot mismatch.');
  if (body.network_id()?.kind() !== Cardano.NetworkId.testnet().kind()) throw new Error('Unsigned initialize candidate is not network id 0/testnet.');

  const signer = body.required_signers()?.get(0)?.to_hex();
  if (body.required_signers()?.len() !== 1 || signer !== candidate.ownerPaymentKeyHash) {
    throw new Error('Unsigned initialize candidate required signer is not the bound owner payment key.');
  }

  const stateOutput = body.outputs().get(0);
  const changeOutput = body.outputs().get(1);
  if (stateOutput.address().to_bech32() !== appliedValidatorIdentity.recoveryVault.address) {
    throw new Error('Unsigned initialize state output is not locked at the applied recovery validator.');
  }
  if (changeOutput.address().to_bech32() !== utxoBindingEvidence.roles.seed.address) {
    throw new Error('Unsigned initialize change output does not return to the seed wallet address.');
  }
  if (stateOutput.plutus_data() == null) throw new Error('Unsigned initialize state output is missing its inline vault datum.');

  const stateMinimumAda = minAdaCheck(stateOutput, parameters, 'Unsigned initialize state output');
  const changeMinimumAda = minAdaCheck(changeOutput, parameters, 'Unsigned initialize change output');
  const stateValueSize = valueSizeCheck(stateOutput, parameters, 'Unsigned initialize state output');
  const changeValueSize = valueSizeCheck(changeOutput, parameters, 'Unsigned initialize change output');
  const collateralReturn = body.collateral_return();
  if (!collateralReturn) throw new Error('Unsigned initialize candidate is missing collateral return.');
  if (collateralReturn.address().to_bech32() !== utxoBindingEvidence.roles.collateral.address) {
    throw new Error('Unsigned initialize collateral return does not return to the collateral wallet address.');
  }
  const collateralReturnMinimumAda = minAdaCheck(collateralReturn, parameters, 'Unsigned initialize collateral return');
  const collateralReturnValueSize = valueSizeCheck(collateralReturn, parameters, 'Unsigned initialize collateral return');

  const feeCheck = calculateCardanoMinimumFee({
    transactionBytes: candidate.transaction.feeSizingBytes,
    memory: candidate.evaluation.mintBudget.memory,
    steps: candidate.evaluation.mintBudget.steps,
    parameters
  });
  if (feeCheck.minimumFee !== candidate.transaction.feeLovelace) {
    throw new Error('Unsigned initialize fee is not the exact minimum for its signed-size estimate and live execution budget.');
  }
  const collateralCheck = calculateCardanoRequiredCollateral({
    feeLovelace: candidate.transaction.feeLovelace,
    parameters
  });
  if (body.total_collateral()?.to_str() !== collateralCheck.requiredCollateral) {
    throw new Error('Unsigned initialize total collateral does not match the current required collateral.');
  }

  const seedLovelace = BigInt(utxoBindingEvidence.roles.seed.lovelace);
  const stateLovelace = BigInt(stateOutput.amount().coin().to_str());
  const changeLovelace = BigInt(changeOutput.amount().coin().to_str());
  const feeLovelace = BigInt(body.fee().to_str());
  if (seedLovelace !== stateLovelace + changeLovelace + feeLovelace) {
    throw new Error('Unsigned initialize ADA conservation failed for the seed input, outputs and fee.');
  }
  const collateralLovelace = BigInt(utxoBindingEvidence.roles.collateral.lovelace);
  const totalCollateral = BigInt(body.total_collateral().to_str());
  const collateralReturnLovelace = BigInt(collateralReturn.amount().coin().to_str());
  if (collateralLovelace !== totalCollateral + collateralReturnLovelace) {
    throw new Error('Unsigned initialize collateral conservation failed.');
  }

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-unsigned-initialize-preflight.v1',
    network: 'preprod',
    action: 'initialize',
    candidateSha256: candidate.candidateSha256,
    validatorIdentitySha256: appliedValidatorIdentity.identitySha256,
    utxoBindingEvidenceSha256: utxoBindingEvidence.evidenceSha256,
    stableTip: utxoBindingEvidence.stableTip,
    checks: Object.freeze({
      exactSeedInputBound: true,
      exactCollateralInputBound: true,
      canonicalRoundTripVerified: true,
      bodyHashVerified: true,
      currentProtocolParametersIndependentlyConfirmed: parameters.independentlyConfirmed === true && parameters.sourceCount >= 2,
      feeVerifiedAgainstSignedSizeEstimate: true,
      adaBalanceValidated: true,
      collateralBalanceValidated: true,
      collateralRequirementValidated: true,
      stateMinimumAda,
      changeMinimumAda,
      collateralReturnMinimumAda,
      stateValueSize,
      changeValueSize,
      collateralReturnValueSize,
      ownerRequiredSignerBound: true,
      walletWitnessesPresent: false,
      walletWitnessesValidated: false,
      unsignedPhaseOnePreflightComplete: true,
      fullPhaseOneValidated: false
    }),
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false
    }),
    nextGate: 'wallet-witness-policy-and-signature-verification-before-complete-phase-one-and-submission',
    authorityBoundary: 'This preflight independently checks the real-input unsigned initialize candidate, current fee/collateral/min-ADA requirements, balance, validity and owner signer intent. Missing wallet witnesses intentionally keep complete phase-1 validation false and prohibit signing/submission claims.'
  });
  return Object.freeze({ ...core, preflightSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodUnsignedInitializePreflight({
  preflight,
  ...inputs
}) {
  if (!preflight || typeof preflight !== 'object' || Array.isArray(preflight)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Cardano unsigned initialize preflight evidence is required.']), recomputedSha256: null });
  }
  const errors = [];
  let recomputed;
  try {
    recomputed = createCardanoPreprodUnsignedInitializePreflight(inputs);
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([error.message]), recomputedSha256: null });
  }
  const core = Object.fromEntries(Object.entries(preflight).filter(([key]) => key !== 'preflightSha256'));
  if (preflight.preflightSha256 !== hashCardanoEvidence(core)) errors.push('Cardano unsigned initialize preflight self-digest mismatch.');
  if (preflight.preflightSha256 !== recomputed.preflightSha256) errors.push('Cardano unsigned initialize preflight does not reproduce from its bound candidate/evidence.');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), recomputedSha256: recomputed.preflightSha256 });
}
