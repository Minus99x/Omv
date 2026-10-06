import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from './evidence-binding.js';
import {
  CARDANO_PREPROD_EVALUATION_VALIDITY_WINDOW_SLOTS,
  CARDANO_PREPROD_NETWORK_ID,
  cardanoPreprodSlotToUnixTimeMs,
  createCardanoVaultDatumData
} from './transaction-body.js';
import {
  calculateCardanoMinimumFee,
  calculateCardanoRequiredCollateral
} from './protocol-parameters.js';
import { calculateCardanoMinRequiredLovelace } from './recovery-validator.js';
import { createCardanoPlutusV3CostModels } from './witness-set.js';
import { createCardanoOgmiosEvaluationRequest } from './ogmios-evaluation.js';

const HEX_28 = /^[0-9a-f]{56}$/i;
const HEX_32 = /^[0-9a-f]{64}$/i;

function hex(value) {
  return Buffer.from(value).toString('hex');
}

function withoutDigest(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function positiveBigInt(value, label) {
  const text = String(value);
  if (!/^\d+$/.test(text) || BigInt(text) < 1n) throw new TypeError(`${label} must be a positive integer.`);
  return BigInt(text);
}

function keyHash(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!HEX_28.test(normalized)) throw new TypeError(`${label} must be 28-byte hex.`);
  return normalized;
}

function referenceInput(reference) {
  return Cardano.TransactionInput.new(
    Cardano.TransactionHash.from_hex(reference.transaction.id),
    reference.index
  );
}

function enterpriseKeyAddressFromHash(hash) {
  const credential = Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(hash));
  return Cardano.EnterpriseAddress.new(CARDANO_PREPROD_NETWORK_ID, credential).to_address();
}

function valueWithBeacon(lovelace, policyId, assetNameHex) {
  const value = Cardano.Value.new(Cardano.BigNum.from_str(String(lovelace)));
  const assets = Cardano.Assets.new();
  assets.insert(
    Cardano.AssetName.new(Uint8Array.from(Buffer.from(assetNameHex, 'hex'))),
    Cardano.BigNum.one()
  );
  const multiasset = Cardano.MultiAsset.new();
  multiasset.insert(Cardano.ScriptHash.from_hex(policyId), assets);
  value.set_multiasset(multiasset);
  return value;
}

function setBeaconMint(body, policyId, assetNameHex) {
  const assets = Cardano.MintAssets.new();
  assets.insert(
    Cardano.AssetName.new(Uint8Array.from(Buffer.from(assetNameHex, 'hex'))),
    Cardano.Int.from_str('1')
  );
  const mint = Cardano.Mint.new();
  mint.insert(Cardano.ScriptHash.from_hex(policyId), assets);
  body.set_mint(mint);
}

function constr0() {
  const list = Cardano.PlutusList.new();
  return Cardano.PlutusData.new_constr_plutus_data(
    Cardano.ConstrPlutusData.new(Cardano.BigNum.zero(), list)
  );
}

function exUnits(memory, steps) {
  return Cardano.ExUnits.new(
    Cardano.BigNum.from_str(String(memory)),
    Cardano.BigNum.from_str(String(steps))
  );
}

function mintRedeemer(memory, steps) {
  return Cardano.Redeemer.new(
    Cardano.RedeemerTag.new_mint(),
    Cardano.BigNum.zero(),
    constr0(),
    exUnits(memory, steps)
  );
}

function fakeKeyWitness(witnessSet, body) {
  const clone = Cardano.TransactionWitnessSet.from_bytes(witnessSet.to_bytes());
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(body.to_bytes(), { dkLen: 32 }));
  const key = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 1));
  const witnesses = Cardano.Vkeywitnesses.new();
  witnesses.add(Cardano.make_vkey_witness(bodyHash, key));
  clone.set_vkeys(witnesses);
  return clone;
}

function validateIdentity(identity) {
  const value = plainObject(identity, 'appliedValidatorIdentity');
  if (value.schema !== 'omegavault.cardano.preprod-applied-validator-identity.v1' ||
      value.network !== 'preprod' ||
      value.networkId !== CARDANO_PREPROD_NETWORK_ID) {
    throw new Error('A Cardano Preprod applied validator identity is required.');
  }
  if (!HEX_32.test(String(value.identitySha256 ?? '')) ||
      hashCardanoEvidence(withoutDigest(value, 'identitySha256')) !== String(value.identitySha256).toLowerCase()) {
    throw new Error('Applied validator identity digest is invalid.');
  }
  const policyId = String(value.stateBeacon?.policyId ?? '').toLowerCase();
  const beaconCode = String(value.stateBeacon?.compiledCode ?? '');
  const recoveryHash = String(value.recoveryVault?.scriptHash ?? '').toLowerCase();
  const recoveryAddress = String(value.recoveryVault?.address ?? '');
  if (!HEX_28.test(policyId) || !HEX_28.test(recoveryHash) || !beaconCode) {
    throw new Error('Applied validator identity is missing deployable script identity fields.');
  }
  const beaconScript = Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(beaconCode, 'hex')));
  if (beaconScript.hash().to_hex() !== policyId) throw new Error('Applied beacon compiled code does not hash to its bound policy id.');
  const decodedRecovery = Cardano.Address.from_bech32(recoveryAddress);
  if (decodedRecovery.network_id() !== CARDANO_PREPROD_NETWORK_ID) throw new Error('Applied recovery address is not Cardano Preprod.');
  return Object.freeze({
    identitySha256: value.identitySha256,
    seedReference: value.seedReference,
    assetNameHex: String(value.assetNameHex).toLowerCase(),
    policyId,
    beaconCode,
    recoveryHash,
    recoveryAddress
  });
}

function validateBinding(binding, identity) {
  const value = plainObject(binding, 'utxoBindingEvidence');
  if (value.schema !== 'omegavault.cardano.preprod-real-utxo-binding-evidence.v1' ||
      value.network !== 'preprod' ||
      value.action !== 'initialize' ||
      value.realUtxoReferencesExist !== true ||
      value.exactRoleReferenceBinding !== true ||
      value.phaseOneState?.realUtxoBindingComplete !== true ||
      value.phaseOneState?.fullPhaseOneValidated !== false ||
      value.liveActions?.walletSigningAuthorized !== false ||
      value.liveActions?.transactionSubmissionAuthorized !== false) {
    throw new Error('A fail-closed initialize real UTxO binding evidence record is required.');
  }
  if (value.validatorIdentitySha256 !== identity.identitySha256) {
    throw new Error('Real UTxO binding evidence is bound to a different applied validator identity.');
  }
  if (!HEX_28.test(String(value.walletPaymentKeyHash ?? ''))) throw new Error('Real UTxO binding evidence is missing the wallet payment key hash.');
  for (const role of ['seed', 'collateral']) {
    if (!value.roles?.[role]?.reference || !value.roles?.[role]?.address) throw new Error(`Real UTxO binding evidence is missing ${role}.`);
    positiveBigInt(value.roles[role].lovelace, `${role}.lovelace`);
  }
  if (value.roles.seed.reference.transaction.id !== identity.seedReference.transaction.id ||
      value.roles.seed.reference.index !== identity.seedReference.index) {
    throw new Error('Initialize seed evidence does not match the applied validator identity seed.');
  }
  return value;
}

function validateRecoveryConfig(config, ownerKeyHash) {
  const value = plainObject(config, 'recoveryConfig');
  const rescueKeyHash = keyHash(value.rescueKeyHash, 'recoveryConfig.rescueKeyHash');
  const contacts = value.contactKeyHashes;
  if (!Array.isArray(contacts) || contacts.length < 1) throw new TypeError('recoveryConfig.contactKeyHashes must contain at least one contact.');
  const normalizedContacts = contacts.map((entry, index) => keyHash(entry, `recoveryConfig.contactKeyHashes[${index}]`));
  if (new Set(normalizedContacts).size !== normalizedContacts.length) throw new Error('Recovery contacts must be unique.');
  if (normalizedContacts.includes(ownerKeyHash)) throw new Error('Owner cannot also be a trusted contact.');
  const threshold = Number(value.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > normalizedContacts.length) throw new Error('Recovery threshold must be reachable.');
  const inactivityMs = Number(value.inactivityMs);
  if (!Number.isSafeInteger(inactivityMs) || inactivityMs < 1) throw new Error('Recovery inactivityMs must be positive.');
  const stateLovelace = positiveBigInt(value.stateLovelace ?? '5000000', 'recoveryConfig.stateLovelace');
  return Object.freeze({ rescueKeyHash, contactKeyHashes: Object.freeze(normalizedContacts), threshold, inactivityMs, stateLovelace });
}

function minimumAdaForOutput(output, parameters, label) {
  const actual = output.amount().coin().to_str();
  const required = calculateCardanoMinRequiredLovelace({
    serializedOutputBytes: output.to_bytes().length,
    coinsPerUtxoByte: parameters.coinsPerUtxoByte
  }).minimumLovelace;
  if (BigInt(actual) < BigInt(required)) throw new Error(`${label} is below minimum ADA.`);
  return Object.freeze({
    outputBytes: output.to_bytes().length,
    actualLovelace: actual,
    minimumLovelace: required,
    satisfied: true
  });
}

export function buildCardanoPreprodRealInitializeCandidate({
  appliedValidatorIdentity,
  utxoBindingEvidence,
  parameters,
  recoveryConfig,
  evaluationMode = true,
  mintBudget = null
}) {
  const identity = validateIdentity(appliedValidatorIdentity);
  const binding = validateBinding(utxoBindingEvidence, identity);
  if (!parameters?.independentlyConfirmed || parameters?.sourceCount < 2) {
    throw new Error('Real initialize construction requires independently confirmed current Preprod protocol parameters.');
  }
  const ownerKeyHash = keyHash(binding.walletPaymentKeyHash, 'walletPaymentKeyHash');
  const config = validateRecoveryConfig(recoveryConfig, ownerKeyHash);
  const tipSlot = Number(binding.stableTip?.slot);
  if (!Number.isSafeInteger(tipSlot) || tipSlot < 30) throw new Error('Real UTxO binding evidence is missing a usable stable Preprod slot.');

  let memory = 0n;
  let steps = 0n;
  if (!evaluationMode) {
    memory = positiveBigInt(mintBudget?.memory, 'mintBudget.memory');
    steps = positiveBigInt(mintBudget?.steps, 'mintBudget.steps');
    if (memory > parameters.maxTxExUnits.memory || steps > parameters.maxTxExUnits.steps) {
      throw new Error('Evaluated mint budget exceeds current maxTxExUnits.');
    }
  } else if (mintBudget != null) {
    throw new Error('Evaluation-mode initialize candidates must keep the mint redeemer budget at zero.');
  }

  const lowerSlot = tipSlot - 30;
  const upperSlot = tipSlot + CARDANO_PREPROD_EVALUATION_VALIDITY_WINDOW_SLOTS;
  const heartbeatMs = cardanoPreprodSlotToUnixTimeMs(lowerSlot);
  const seedAmount = positiveBigInt(binding.roles.seed.lovelace, 'seed.lovelace');
  const collateralAmount = positiveBigInt(binding.roles.collateral.lovelace, 'collateral.lovelace');
  const totalSpendInputs = seedAmount;

  const beaconScript = Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(identity.beaconCode, 'hex')));
  const redeemers = Cardano.Redeemers.new();
  redeemers.add(mintRedeemer(evaluationMode ? 0 : memory, evaluationMode ? 0 : steps));
  const scripts = Cardano.PlutusScripts.new();
  scripts.add(beaconScript);
  const models = createCardanoPlutusV3CostModels(parameters.plutusV3CostModel);
  const scriptDataHash = Cardano.hash_script_data(redeemers, models).to_hex();
  const witnessSet = Cardano.TransactionWitnessSet.new();
  witnessSet.set_redeemers(redeemers);
  witnessSet.set_plutus_scripts(scripts);

  const stateAddress = Cardano.Address.from_bech32(identity.recoveryAddress);
  const ownerChangeAddress = Cardano.Address.from_bech32(binding.roles.seed.address);
  const collateralReturnAddress = Cardano.Address.from_bech32(binding.roles.collateral.address);
  const rescueAddress = enterpriseKeyAddressFromHash(config.rescueKeyHash);
  const stateDatum = createCardanoVaultDatumData({
    ownerKeyHash,
    rescueKeyHash: config.rescueKeyHash,
    contactKeyHashes: config.contactKeyHashes,
    threshold: config.threshold,
    inactivityMs: config.inactivityMs,
    lastHeartbeatMs: heartbeatMs,
    approvalKeyHashes: []
  });

  let fee = 200000n;
  let transaction = null;
  let feeResult = null;
  let sizingBytes = 0;
  let stateMinimumAda = null;
  let changeMinimumAda = null;
  let collateralReturnMinimumAda = null;
  let requiredCollateral = null;
  let changeLovelace = null;
  let collateralReturnLovelace = null;
  let iterations = 0;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    iterations = iteration + 1;
    if (totalSpendInputs <= config.stateLovelace + fee) throw new Error('Seed UTxO does not contain enough ADA for the protected state output plus fee and change.');
    changeLovelace = totalSpendInputs - config.stateLovelace - fee;

    const stateOutput = Cardano.TransactionOutput.new(
      stateAddress,
      valueWithBeacon(config.stateLovelace, identity.policyId, identity.assetNameHex)
    );
    stateOutput.set_plutus_data(stateDatum);
    stateMinimumAda = minimumAdaForOutput(stateOutput, parameters, 'Initialize state output');

    const changeOutput = Cardano.TransactionOutput.new(
      ownerChangeAddress,
      Cardano.Value.new(Cardano.BigNum.from_str(changeLovelace.toString()))
    );
    changeMinimumAda = minimumAdaForOutput(changeOutput, parameters, 'Initialize change output');

    requiredCollateral = BigInt(calculateCardanoRequiredCollateral({
      feeLovelace: fee.toString(),
      parameters
    }).requiredCollateral);
    if (collateralAmount <= requiredCollateral) throw new Error('Collateral UTxO does not contain enough ADA for the current collateral requirement plus return.');
    collateralReturnLovelace = collateralAmount - requiredCollateral;
    const collateralReturn = Cardano.TransactionOutput.new(
      collateralReturnAddress,
      Cardano.Value.new(Cardano.BigNum.from_str(collateralReturnLovelace.toString()))
    );
    collateralReturnMinimumAda = minimumAdaForOutput(collateralReturn, parameters, 'Collateral return output');

    const inputs = Cardano.TransactionInputs.new();
    inputs.add(referenceInput(binding.roles.seed.reference));
    const outputs = Cardano.TransactionOutputs.new();
    outputs.add(stateOutput);
    outputs.add(changeOutput);

    const body = Cardano.TransactionBody.new_tx_body(
      inputs,
      outputs,
      Cardano.BigNum.from_str(fee.toString())
    );
    body.set_network_id(Cardano.NetworkId.testnet());
    body.set_validity_start_interval_bignum(Cardano.BigNum.from_str(String(lowerSlot)));
    body.set_ttl(Cardano.BigNum.from_str(String(upperSlot)));
    body.set_script_data_hash(Cardano.ScriptDataHash.from_hex(scriptDataHash));
    setBeaconMint(body, identity.policyId, identity.assetNameHex);

    const requiredSigners = Cardano.Ed25519KeyHashes.new();
    requiredSigners.add(Cardano.Ed25519KeyHash.from_hex(ownerKeyHash));
    body.set_required_signers(requiredSigners);

    const collateral = Cardano.TransactionInputs.new();
    collateral.add(referenceInput(binding.roles.collateral.reference));
    body.set_collateral(collateral);
    body.set_total_collateral(Cardano.BigNum.from_str(requiredCollateral.toString()));
    body.set_collateral_return(collateralReturn);

    const sizingWitnessSet = fakeKeyWitness(witnessSet, body);
    const sizingTransaction = Cardano.Transaction.new(body, sizingWitnessSet);
    sizingBytes = sizingTransaction.to_bytes().length;
    feeResult = calculateCardanoMinimumFee({
      transactionBytes: sizingBytes,
      memory,
      steps,
      parameters
    });
    transaction = Cardano.Transaction.new(body, witnessSet);
    const nextFee = BigInt(feeResult.minimumFee);
    if (nextFee === fee) break;
    fee = nextFee;
  }

  if (!transaction || !feeResult || BigInt(feeResult.minimumFee) !== fee) {
    throw new Error('Real initialize fee/collateral/change iteration did not converge.');
  }

  const txBytes = transaction.to_bytes();
  const roundTrip = Cardano.Transaction.from_bytes(txBytes).to_bytes();
  if (hex(txBytes) !== hex(roundTrip)) throw new Error('Real initialize unsigned transaction did not round-trip canonically.');
  if (transaction.witness_set().vkeys() != null) throw new Error('Real initialize candidate unexpectedly contains a key witness.');

  const bodyHash = hex(blake2b(transaction.body().to_bytes(), { dkLen: 32 }));
  const evaluationRequest = evaluationMode
    ? createCardanoOgmiosEvaluationRequest({
        transactionCborHex: hex(txBytes),
        id: 'omegavault-cardano-preprod-real-initialize-evaluate'
      })
    : null;
  const expectedValidators = Object.freeze(['mint:0']);
  if (evaluationRequest &&
      (evaluationRequest.expectedValidators.length !== 1 || evaluationRequest.expectedValidators[0] !== 'mint:0')) {
    throw new Error('Real initialize candidate must expose exactly the mint:0 redeemer pointer.');
  }

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-real-initialize-candidate.v1',
    network: 'preprod',
    action: 'initialize',
    validatorIdentitySha256: identity.identitySha256,
    utxoBindingEvidenceSha256: binding.evidenceSha256,
    stableTip: binding.stableTip,
    ownerPaymentKeyHash: ownerKeyHash,
    recoveryConfiguration: Object.freeze({
      rescueAddress: rescueAddress.to_bech32(),
      rescueKeyHash: config.rescueKeyHash,
      contactKeyHashes: config.contactKeyHashes,
      threshold: config.threshold,
      inactivityMs: config.inactivityMs,
      stateLovelace: config.stateLovelace.toString()
    }),
    validity: Object.freeze({ lowerSlot, upperSlot, initialHeartbeatMs: heartbeatMs }),
    transaction: Object.freeze({
      bodyHash,
      cborHex: hex(txBytes),
      bytes: txBytes.length,
      feeSizingBytes: sizingBytes,
      feeLovelace: fee.toString(),
      scriptDataHash,
      mintPolicyId: identity.policyId,
      assetNameHex: identity.assetNameHex,
      mintQuantity: '1',
      changeLovelace: changeLovelace.toString(),
      collateralLovelace: collateralAmount.toString(),
      totalCollateral: requiredCollateral.toString(),
      collateralReturnLovelace: collateralReturnLovelace.toString(),
      keyWitnessCount: 0,
      expectedKeyWitnessCountForFeeSizing: 1
    }),
    checks: Object.freeze({
      exactRealInputsBound: true,
      valueConservationChecked: totalSpendInputs === config.stateLovelace + changeLovelace + fee,
      stateMinimumAda,
      changeMinimumAda,
      collateralReturnMinimumAda,
      collateralRequirementSatisfied: collateralAmount >= requiredCollateral + collateralReturnLovelace,
      currentProtocolParametersIndependentlyConfirmed: true,
      unsignedStructuralPreflightPassed: true,
      walletWitnessesValidated: false,
      fullPhaseOneValidated: false
    }),
    evaluation: Object.freeze({
      mode: evaluationMode ? 'zero-budget-live-evaluation-candidate' : 'live-budget-applied-unsigned-candidate',
      mintBudget: Object.freeze({ memory: memory.toString(), steps: steps.toString() }),
      request: evaluationRequest?.request ?? null,
      expectedValidators,
      requiresLiveEvaluation: evaluationMode,
      evaluationSupplementalUtxoRequired: false
    }),
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false
    }),
    nextGate: evaluationMode
      ? 'evaluate-exact-real-input-initialize-candidate-at-a-stable-preprod-tip'
      : 'verify-live-budget-applied-candidate-and-complete-wallet-witness-policy-before-any-signing',
    authorityBoundary: 'This candidate is unsigned and cannot authorize wallet signing or submission. Structural balance/min-ADA/collateral checks are not a claim of complete Cardano phase-1 validation.'
  });

  return Object.freeze({ ...core, candidateSha256: hashCardanoEvidence(core) });
}


export function verifyCardanoPreprodRealInitializeCandidate({
  candidate,
  appliedValidatorIdentity,
  utxoBindingEvidence,
  parameters,
  recoveryConfig,
  evaluationMode = true,
  mintBudget = null
}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Cardano real initialize candidate is required.']), recomputedSha256: null });
  }
  const errors = [];
  let recomputed;
  try {
    recomputed = buildCardanoPreprodRealInitializeCandidate({
      appliedValidatorIdentity,
      utxoBindingEvidence,
      parameters,
      recoveryConfig,
      evaluationMode,
      mintBudget
    });
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([error.message]), recomputedSha256: null });
  }

  const selfCore = withoutDigest(candidate, 'candidateSha256');
  if (candidate.candidateSha256 !== hashCardanoEvidence(selfCore)) {
    errors.push('Cardano real initialize candidate self-digest mismatch.');
  }
  if (candidate.candidateSha256 !== recomputed.candidateSha256) {
    errors.push('Cardano real initialize candidate does not reproduce from its bound identity, UTxOs, protocol parameters and recovery configuration.');
  }

  try {
    const tx = Cardano.Transaction.from_hex(candidate.transaction?.cborHex ?? '');
    if (tx.witness_set().vkeys() != null) errors.push('Cardano real initialize candidate contains unexpected wallet key witnesses.');
    if (tx.body().network_id()?.kind() !== Cardano.NetworkId.testnet().kind()) errors.push('Cardano real initialize candidate is not testnet/Preprod network id 0.');
    if (tx.body().inputs().len() !== 1) errors.push('Cardano real initialize candidate must consume exactly one normal seed input.');
    if (tx.body().collateral()?.len() !== 1) errors.push('Cardano real initialize candidate must bind exactly one collateral input.');
    if (tx.body().required_signers()?.len() !== 1) errors.push('Cardano real initialize candidate must require exactly one owner wallet signer.');
  } catch (error) {
    errors.push(`Cardano real initialize candidate CBOR is invalid: ${error.message}`);
  }

  if (candidate.checks?.unsignedStructuralPreflightPassed !== true ||
      candidate.checks?.walletWitnessesValidated !== false ||
      candidate.checks?.fullPhaseOneValidated !== false ||
      candidate.liveActions?.walletSigningAuthorized !== false ||
      candidate.liveActions?.transactionSubmissionAuthorized !== false ||
      candidate.liveActions?.liveValueMovementAuthorized !== false ||
      candidate.liveActions?.supportClaimAuthorized !== false) {
    errors.push('Cardano real initialize candidate authority/phase-one boundary was weakened.');
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    recomputedSha256: recomputed.candidateSha256
  });
}
