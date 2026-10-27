import { normalizeCardanoProtocolParameterSnapshot } from './protocol-parameters.js';
import { isDeepStrictEqual } from 'node:util';
import { hashCardanoEvidence } from './evidence-binding.js';
import { createCardanoPreprodInitializeWalletWitnessEvidence } from './preprod-initialize-wallet-witness.js';
import { createCardanoPreprodInitializePreSubmitEvidence } from './preprod-initialize-presubmit.js';
import { createCardanoPreprodIndependentPhaseOneInput } from './preprod-independent-phase-one-input.js';

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
  }
  return value;
}

function stage(name, operation) {
  try { return operation(); }
  catch (cause) {
    throw new Error(`Cardano initialize validation failed at ${name}: ${cause.message}`, { cause });
  }
}

// Consume existing signed bytes only. CSL and noble perform the underlying
// CBOR/signature checks in the existing gates; this module binds their outputs.
export function prepareCardanoPreprodInitializeValidationPackage(inputs) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    throw new TypeError('Initialize validation inputs must be an object.');
  }
  const captured = stage('input capture', () => structuredClone(inputs));
  const {
    signedTransactionCborHex, unsignedCandidate, unsignedPreflight,
    appliedValidatorIdentity, utxoBindingEvidence, currentProtocolSnapshot,
    currentParameters: suppliedParameters, recoveryConfig, currentTip, currentQueriedUtxo
  } = captured;
  const currentParameters = stage('protocol parameters', () => normalizeCardanoProtocolParameterSnapshot(currentProtocolSnapshot));
  if (suppliedParameters != null && !isDeepStrictEqual(suppliedParameters, currentParameters)) {
    throw new Error('Supplied protocol parameters do not match the captured snapshot.');
  }
  const boundTip = utxoBindingEvidence?.stableTip;
  if (!Number.isSafeInteger(boundTip?.slot) || !Number.isSafeInteger(currentTip?.slot) ||
      currentTip.slot < boundTip.slot ||
      (currentTip.slot === boundTip.slot && currentTip.hash?.toLowerCase() !== boundTip.hash?.toLowerCase())) {
    throw new Error('Current ledger tip must not precede or contradict the bound UTxO tip.');
  }
  const witnessEvidence = stage('wallet witness', () => createCardanoPreprodInitializeWalletWitnessEvidence({
    signedTransactionCborHex, unsignedCandidate, unsignedPreflight,
    appliedValidatorIdentity, utxoBindingEvidence, parameters: currentParameters, recoveryConfig
  }));
  const preSubmitEvidence = stage('current ledger', () => createCardanoPreprodInitializePreSubmitEvidence({
    witnessEvidence, signedTransactionCborHex, unsignedCandidate, unsignedPreflight,
    appliedValidatorIdentity, utxoBindingEvidence, currentProtocolSnapshot,
    currentParameters, recoveryConfig, currentTip, currentQueriedUtxo
  }));
  const phaseOneInput = stage('independent validator input', () => createCardanoPreprodIndependentPhaseOneInput({
    witnessEvidence, preSubmitEvidence, signedTransactionCborHex
  }));
  const core = {
    schema: 'omegavault.cardano.preprod-initialize-validation-package.v1',
    network: 'preprod', action: 'initialize',
    witnessEvidence, preSubmitEvidence, phaseOneInput,
    completePhaseOneValidated: false,
    transactionSubmissionAuthorized: false,
    transactionSubmissionPerformed: false,
    supportClaimAuthorized: false,
    nextGate: phaseOneInput.nextGate
  };
  return freezeTree({ ...core, packageSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodInitializeValidationPackage({ package: supplied, inputs }) {
  try {
    const expected = prepareCardanoPreprodInitializeValidationPackage(inputs);
    const valid = isDeepStrictEqual(supplied, expected);
    return Object.freeze({ valid, errors: Object.freeze(valid ? [] : ['Initialize validation package does not reproduce from the supplied signed bytes and ledger inputs.']),
      completePhaseOneValidated: false, transactionSubmissionAuthorized: false });
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([error.message]),
      completePhaseOneValidated: false, transactionSubmissionAuthorized: false });
  }
}

// Replay the freshly reproduced package, never an unchecked saved receipt.
// Scalus uses a disposable local ledger with its bundled Preprod parameters;
// its verdict is not a current public-ledger phase-one certificate.
export async function replayCardanoPreprodInitializeValidationPackage(inputs, { scalusApi = null } = {}) {
  const prepared = prepareCardanoPreprodInitializeValidationPackage(inputs);
  const { runCardanoScalusInitializeTrial } = await import('./scalus-local-validation.js');
  const trial = await runCardanoScalusInitializeTrial({
    signedTransactionCborHex: prepared.phaseOneInput.signedTransaction.cborHex,
    preSubmitEvidence: prepared.preSubmitEvidence,
    simulatedSlot: prepared.phaseOneInput.ledgerContext.tip.slot,
    scalusApi,
    useCapturedProtocolParameters: true
  });
  if (trial.acceptedByEmulator && trial.localTransactionHash !== prepared.phaseOneInput.signedTransaction.bodyHash) {
    throw new Error('Local validator transaction hash differs from the exact prepared body.');
  }
  const core = {
    schema: 'omegavault.cardano.preprod-initialize-package-replay.v1',
    packageSha256: prepared.packageSha256,
    validationPackage: prepared,
    validatorSource: scalusApi == null ? 'installed-scalus' : 'injected-test-api',
    parameterContext: trial.protocolContext.mode,
    trial,
    completeCurrentPreprodPhaseOneValidated: false,
    transactionSubmissionAuthorized: false,
    transactionSubmissionPerformed: false,
    supportClaimAuthorized: false
  };
  return freezeTree({ ...core, replaySha256: hashCardanoEvidence(core) });
}
