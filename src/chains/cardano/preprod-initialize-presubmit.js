import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { hashCardanoEvidence } from './evidence-binding.js';
import { calculateCardanoMinimumFee, normalizeCardanoProtocolParameterSnapshot } from './protocol-parameters.js';
import { verifyCardanoPreprodInitializeWalletWitnessEvidence } from './preprod-initialize-wallet-witness.js';
import { createCardanoPreprodUnsignedInitializePreflight } from './preprod-unsigned-initialize-preflight.js';

const HEX_32 = /^[0-9a-f]{64}$/i;

function refKey(reference) {
  return `${reference?.transaction?.id ?? ''}#${reference?.index ?? ''}`;
}

function normalizedTip(tip) {
  const hash = typeof tip?.hash === 'string' ? tip.hash.toLowerCase() : '';
  const slot = tip?.slot;
  if (!HEX_32.test(hash) || /^0{64}$/.test(hash) || typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 0) {
    throw new TypeError('A current stable Cardano Preprod tip hash/slot is required.');
  }
  return Object.freeze({ hash, slot });
}

function currentUtxoByReference(queriedUtxo) {
  if (!Array.isArray(queriedUtxo)) throw new TypeError('currentQueriedUtxo must be an array.');
  const result = new Map();
  for (const [index, utxo] of queriedUtxo.entries()) {
    const key = refKey(utxo);
    if (!/^[0-9a-f]{64}#\d+$/i.test(key)) throw new TypeError(`currentQueriedUtxo[${index}] has an invalid output reference.`);
    if (result.has(key)) throw new Error(`Current UTxO query returned duplicate output reference ${key}.`);
    result.set(key, utxo);
  }
  return result;
}

function verifyRoleStillUnspent(role, boundRole, current) {
  const key = refKey(boundRole.reference);
  const found = current.get(key);
  if (!found) throw new Error(`Bound ${role} UTxO is no longer unspent at the current Preprod tip: ${key}.`);
  if (found.address !== boundRole.address) throw new Error(`Current ${role} UTxO address differs from the bound evidence.`);
  if (hashCardanoEvidence(found.value) !== boundRole.valueSha256) throw new Error(`Current ${role} UTxO value differs from the bound evidence.`);
  if (String(found.value?.ada?.lovelace ?? '') !== String(boundRole.lovelace)) throw new Error(`Current ${role} UTxO lovelace differs from the bound evidence.`);

  const datumPresent = found.datum != null || found.datumHash != null;
  const referenceScriptPresent = found.script != null;
  if (datumPresent !== Boolean(boundRole.datumPresent)) {
    throw new Error(`Current ${role} UTxO datum presence differs from the bound evidence.`);
  }
  if (referenceScriptPresent !== Boolean(boundRole.referenceScriptPresent)) {
    throw new Error(`Current ${role} UTxO reference-script presence differs from the bound evidence.`);
  }

  return Object.freeze({
    reference: boundRole.reference,
    address: found.address,
    lovelace: String(found.value.ada.lovelace),
    valueSha256: boundRole.valueSha256,
    datumPresent,
    referenceScriptPresent,
    stillUnspent: true,
    exactValuePreserved: true,
    exactOutputShapePreserved: true
  });
}

function withoutDigest(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'preSubmitSha256'));
}

// Preserve complete, query-returned UTxO values (not just their hashes) for
// independent ledger validation. These are read-only observations and are
// bound to the exact stable Preprod tip used for the freshness gate.
function fullCurrentInput(roleName, checkedRole, current) {
  const key = refKey(checkedRole.reference);
  const found = current.get(key);
  if (!found) throw new Error(`Current ${roleName} output disappeared before ledger snapshot binding.`);
  if (found.datum != null || found.datumHash != null || found.script != null ||
      checkedRole.datumPresent || checkedRole.referenceScriptPresent) {
    throw new Error(`Initialize ${roleName} must remain a plain ADA-only, datum-free, reference-script-free UTxO.`);
  }
  const nonAdaPolicies = Object.keys(found.value ?? {}).filter(name => name !== 'ada');
  if (nonAdaPolicies.length !== 0) throw new Error(`Initialize ${roleName} has unexpected native assets.`);
  if (hashCardanoEvidence(found.value) !== checkedRole.valueSha256) {
    throw new Error(`Current ${roleName} full value does not match bound digest.`);
  }
  return Object.freeze({
    reference: checkedRole.reference,
    address: checkedRole.address,
    value: found.value,
    datumHash: null,
    datum: null,
    script: null
  });
}

export function createCardanoPreprodInitializePreSubmitEvidence({
  witnessEvidence,
  signedTransactionCborHex,
  unsignedCandidate,
  unsignedPreflight,
  appliedValidatorIdentity,
  utxoBindingEvidence,
  currentProtocolSnapshot,
  currentParameters,
  recoveryConfig,
  currentTip,
  currentQueriedUtxo
}) {
  if (!currentParameters?.independentlyConfirmed || currentParameters?.sourceCount < 2) {
    throw new Error('Pre-submit gate requires current independently confirmed Cardano Preprod protocol parameters.');
  }
  if (!Number.isSafeInteger(currentParameters.maxValueSize) || currentParameters.maxValueSize < 1) {
    throw new Error('Pre-submit gate requires the current Cardano maxValueSize protocol parameter.');
  }

  const tip = normalizedTip(currentTip);
  if (currentProtocolSnapshot?.schemaVersion !== 2) {
    throw new Error('Pre-submit gate requires a current live Cardano protocol snapshot schemaVersion 2.');
  }
  const snapshotTipHash = String(currentProtocolSnapshot?.tip?.blockHash ?? '').toLowerCase();
  const snapshotTipSlot = currentProtocolSnapshot?.tip?.slot;
  const snapshotSourceBlockHash = String(currentProtocolSnapshot?.parameters?.sourceBlockHash ?? '').toLowerCase();
  if (snapshotTipHash !== tip.hash || typeof snapshotTipSlot !== 'number' ||
      !Number.isSafeInteger(snapshotTipSlot) || snapshotTipSlot !== tip.slot ||
      snapshotSourceBlockHash !== tip.hash) {
    throw new Error('Current protocol snapshot tip does not match the current stable Preprod tip.');
  }

  const normalizedSnapshotParameters = normalizeCardanoProtocolParameterSnapshot(currentProtocolSnapshot);
  const currentProtocolParametersSha256 = hashCardanoEvidence(currentParameters);
  if (hashCardanoEvidence(normalizedSnapshotParameters) !== currentProtocolParametersSha256) {
    throw new Error('Current normalized protocol parameters do not reproduce from the bound live protocol snapshot.');
  }
  const currentProtocolSnapshotSha256 = hashCardanoEvidence(currentProtocolSnapshot);

  const witnessCheck = verifyCardanoPreprodInitializeWalletWitnessEvidence({
    evidence: witnessEvidence,
    signedTransactionCborHex,
    unsignedCandidate,
    unsignedPreflight,
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters: currentParameters,
    recoveryConfig
  });
  if (!witnessCheck.valid) {
    throw new Error(`Wallet witness evidence is not valid under the current protocol-parameter preflight: ${witnessCheck.errors.join('; ')}`);
  }

  const recomputedUnsignedPreflight = createCardanoPreprodUnsignedInitializePreflight({
    candidate: unsignedCandidate,
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters: currentParameters,
    recoveryConfig
  });
  if (recomputedUnsignedPreflight.preflightSha256 !== unsignedPreflight.preflightSha256) {
    throw new Error('Current protocol parameters no longer reproduce the frozen unsigned preflight; rebuild/re-evaluate before submission.');
  }
  const valueSizeChecks = [
    recomputedUnsignedPreflight.checks.stateValueSize,
    recomputedUnsignedPreflight.checks.changeValueSize,
    recomputedUnsignedPreflight.checks.collateralReturnValueSize
  ];
  if (valueSizeChecks.some(check => check?.parameterAvailable !== true || check?.satisfied !== true)) {
    throw new Error('Signed initialize outputs are not proven within the current maxValueSize limit.');
  }

  // Cardano validity intervals are half-open: [invalidBefore, invalidHereafter).
  // Missing or malformed bounds MUST fail closed rather than letting
  // comparisons with undefined/NaN silently pass the freshness gate.
  const lowerSlot = unsignedCandidate?.validity?.lowerSlot;
  const upperSlot = unsignedCandidate?.validity?.upperSlot;
  if (!Number.isSafeInteger(lowerSlot) || lowerSlot < 0 ||
      !Number.isSafeInteger(upperSlot) || upperSlot <= lowerSlot) {
    throw new Error('Initialize candidate has invalid lower/upper validity bounds.');
  }
  if (tip.slot < lowerSlot) {
    throw new Error('Current Preprod tip is before the initialize validity interval.');
  }
  if (tip.slot >= upperSlot) {
    throw new Error('Initialize validity interval has expired; rebuild from fresh real UTxO evidence.');
  }

  const current = currentUtxoByReference(currentQueriedUtxo);
  if (current.size !== 2) throw new Error('Pre-submit UTxO query must return exactly the bound seed and collateral outputs.');
  const seed = verifyRoleStillUnspent('seed', utxoBindingEvidence.roles.seed, current);
  const collateral = verifyRoleStillUnspent('collateral', utxoBindingEvidence.roles.collateral, current);
  const ledgerInputSnapshotCore = Object.freeze({
    source: 'read-only-ogmios-queryLedgerState/utxo',
    tip,
    utxos: Object.freeze({
      seed: fullCurrentInput('seed', seed, current),
      collateral: fullCurrentInput('collateral', collateral, current)
    })
  });
  const ledgerInputSnapshotSha256 = hashCardanoEvidence(ledgerInputSnapshotCore);

  const signedTx = Cardano.Transaction.from_hex(signedTransactionCborHex);
  const unsignedTx = Cardano.Transaction.from_hex(unsignedCandidate.transaction.cborHex);
  if (signedTx.body().to_hex() !== unsignedTx.body().to_hex()) {
    throw new Error('Signed transaction body no longer matches the frozen unsigned initialize candidate.');
  }

  const signedTransactionBytes = signedTx.to_bytes().length;
  const mintBudget = unsignedCandidate.evaluation?.mintBudget;
  const signedFeeCheck = calculateCardanoMinimumFee({
    transactionBytes: signedTransactionBytes,
    memory: mintBudget?.memory,
    steps: mintBudget?.steps,
    parameters: currentParameters
  });
  const signedFeeLovelace = signedTx.body().fee().to_str();
  if (BigInt(signedFeeLovelace) < BigInt(signedFeeCheck.minimumFee)) {
    throw new Error('Signed initialize transaction fee is below the current minimum for its actual serialized size and execution units.');
  }
  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-initialize-pre-submit-evidence.v3',
    network: 'preprod',
    action: 'initialize',
    witnessEvidenceSha256: witnessEvidence.witnessEvidenceSha256,
    unsignedCandidateSha256: unsignedCandidate.candidateSha256,
    unsignedPreflightSha256: unsignedPreflight.preflightSha256,
    validatorIdentitySha256: appliedValidatorIdentity.identitySha256,
    utxoBindingEvidenceSha256: utxoBindingEvidence.evidenceSha256,
    currentProtocolSnapshotSha256,
    currentProtocolParametersSha256,
    currentProtocolSnapshot,
    currentTip: tip,
    unsignedTransactionBodyCborHex: unsignedTx.body().to_hex(),
    signedTransaction: Object.freeze({
      sha256: witnessEvidence.signedTransactionSha256,
      bytes: signedTransactionBytes,
      feeLovelace: signedFeeLovelace,
      currentMinimumFeeLovelace: signedFeeCheck.minimumFee
    }),
    validity: Object.freeze({
      lowerSlot: unsignedCandidate.validity.lowerSlot,
      upperSlot: unsignedCandidate.validity.upperSlot,
      currentTipWithinInterval: true
    }),
    currentInputs: Object.freeze({ seed, collateral }),
    ledgerInputSnapshot: ledgerInputSnapshotCore,
    ledgerInputSnapshotSha256,
    checks: Object.freeze({
      currentProtocolParametersIndependentlyConfirmed: true,
      frozenUnsignedPreflightStillReproduces: true,
      walletWitnessEvidenceVerified: true,
      exactSignedBodyPreserved: true,
      currentProtocolSnapshotBoundAndReproducible: true,
      currentProtocolSnapshotStableTipBound: true,
      currentProtocolParametersBoundByDigest: true,
      signedTransactionSizeWithinCurrentMaximum: signedTransactionBytes <= currentParameters.maxTxSize,
      signedExecutionUnitsWithinCurrentMaximum: true,
      signedFeeCoversCurrentMinimum: true,
      outputValueSizesWithinCurrentMaximum: true,
      seedStillUnspent: true,
      collateralStillUnspent: true,
      boundInputValuesUnchanged: true,
      boundInputOutputShapeUnchanged: true,
      completeCurrentInputValuesPreserved: true,
      validityIntervalCurrent: true,
      preSubmitFreshnessGateComplete: true,
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
    nextGate: 'independent-complete-phase-one-ledger-validation-and-explicit-human-submission-authorization',
    authorityBoundary: 'This gate proves the signed initialize body/witness remains bound to two still-unspent real Preprod inputs under a persisted, digest-bound and reproducible current protocol-parameter snapshot bound to the same stable tip as the freshness UTxO evidence, verifies the actual signed transaction size/execution-unit fee floor and each output value against current maxValueSize, and requires an unexpired validity interval. It intentionally does not claim complete node phase-1 validation and does not authorize submission.'
  });
  return Object.freeze({ ...core, preSubmitSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodInitializePreSubmitEvidence({
  evidence,
  ...inputs
}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Cardano initialize pre-submit evidence is required.']), recomputedSha256: null });
  }
  const errors = [];
  let recomputed;
  try {
    recomputed = createCardanoPreprodInitializePreSubmitEvidence(inputs);
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([error.message]), recomputedSha256: null });
  }
  if (hashCardanoEvidence(withoutDigest(evidence)) !== evidence.preSubmitSha256) errors.push('Cardano initialize pre-submit evidence self-digest mismatch.');
  if (evidence.preSubmitSha256 !== recomputed.preSubmitSha256) errors.push('Cardano initialize pre-submit evidence does not reproduce from current ledger/input evidence.');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), recomputedSha256: recomputed.preSubmitSha256 });
}
