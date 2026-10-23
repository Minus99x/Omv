import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from './evidence-binding.js';
import { verifyCardanoPreprodAppliedValidatorIdentity } from './live-validator-identity.js';
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
import { cardanoPositiveSafeInteger } from './policy-integer.js';

const HEX_28=/^[0-9a-f]{56}$/i;
const HEX_32=/^[0-9a-f]{64}$/i;

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
  const normalized=String(value);
  if (!/^\d+$/.test(normalized) || BigInt(normalized)<1n) throw new TypeError(`${label} must be a positive integer.`);
  return BigInt(normalized);
}

function keyHash(value, label) {
  const normalized=String(value ?? '').toLowerCase();
  if (!HEX_28.test(normalized)) throw new TypeError(`${label} must be 28-byte hex.`);
  return normalized;
}

function normalizeReference(value, label) {
  const id=String(value?.transaction?.id ?? '').toLowerCase();
  const index=Number(value?.index);
  if (!HEX_32.test(id)) throw new TypeError(`${label}.transaction.id must be 32-byte hex.`);
  if (!Number.isSafeInteger(index) || index<0) throw new TypeError(`${label}.index must be a non-negative safe integer.`);
  return Object.freeze({ transaction:Object.freeze({ id }), index });
}

function referenceInput(reference) {
  return Cardano.TransactionInput.new(
    Cardano.TransactionHash.from_hex(reference.transaction.id),
    reference.index
  );
}

function compareReferences(left, right) {
  if (left.transaction.id<right.transaction.id) return -1;
  if (left.transaction.id>right.transaction.id) return 1;
  return left.index-right.index;
}

function sameReference(input, reference) {
  return input.transaction_id().to_hex()===reference.transaction.id && input.index()===reference.index;
}

function inputIndex(body, reference) {
  const inputs=body.inputs();
  for (let index=0; index<inputs.len(); index+=1) {
    if (sameReference(inputs.get(index), reference)) return index;
  }
  return -1;
}

function validateIdentity(value) {
  const identity=plainObject(value, 'appliedValidatorIdentity');
  const verification=verifyCardanoPreprodAppliedValidatorIdentity(identity);
  if (!verification.valid) throw new Error(`Applied validator identity verification failed: ${verification.errors.join('; ')}`);
  if (identity.network!=='preprod' || identity.networkId!==CARDANO_PREPROD_NETWORK_ID) {
    throw new Error('Heartbeat requires a Cardano Preprod applied validator identity.');
  }
  const recoveryAddress=String(identity.recoveryVault?.address ?? '');
  const recoveryHash=String(identity.recoveryVault?.scriptHash ?? '').toLowerCase();
  const recoveryCode=String(identity.recoveryVault?.compiledCode ?? '');
  const policyId=String(identity.stateBeacon?.policyId ?? '').toLowerCase();
  const assetNameHex=String(identity.assetNameHex ?? '').toLowerCase();
  if (!HEX_28.test(recoveryHash) || !HEX_28.test(policyId) || !recoveryCode || !/^[0-9a-f]*$/i.test(assetNameHex) || assetNameHex.length%2!==0) {
    throw new Error('Applied validator identity is missing heartbeat script/beacon identity fields.');
  }
  const recoveryScript=Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(recoveryCode, 'hex')));
  if (recoveryScript.hash().to_hex()!==recoveryHash) throw new Error('Applied recovery compiled code does not hash to its bound validator hash.');
  const decoded=Cardano.Address.from_bech32(recoveryAddress);
  if (decoded.network_id()!==CARDANO_PREPROD_NETWORK_ID) throw new Error('Applied recovery address is not Cardano Preprod.');
  return Object.freeze({
    identitySha256:identity.identitySha256,
    recoveryAddress,
    recoveryHash,
    recoveryCode,
    policyId,
    assetNameHex
  });
}

function validatePlan(value, identity) {
  const plan=plainObject(value, 'heartbeatPlan');
  if (plan.schema!=='omegavault.cardano.preprod-real-heartbeat-plan.v1' ||
      plan.network!=='preprod' ||
      plan.action!=='heartbeat' ||
      plan.liveActions?.walletSigningAuthorized!==false ||
      plan.liveActions?.transactionSubmissionAuthorized!==false ||
      plan.liveActions?.supportClaimAuthorized!==false) {
    throw new Error('A fail-closed real Cardano Preprod heartbeat plan is required.');
  }
  if (!HEX_32.test(String(plan.planSha256 ?? '')) ||
      hashCardanoEvidence(withoutDigest(plan, 'planSha256'))!==plan.planSha256) {
    throw new Error('Real heartbeat plan self-digest mismatch.');
  }
  if (plan.validatorIdentitySha256!==identity.identitySha256) {
    throw new Error('Real heartbeat plan is bound to a different applied validator identity.');
  }
  if (plan.protectedState?.address!==identity.recoveryAddress ||
      plan.protectedState?.beaconPolicyId!==identity.policyId ||
      plan.protectedState?.beaconAssetNameHex!==identity.assetNameHex ||
      plan.protectedState?.beaconQuantity!=='1') {
    throw new Error('Real heartbeat plan protected-state identity does not match the applied validator.');
  }
  const predecessorHeartbeatMs=Number(plan.protectedState?.predecessorLastHeartbeatMs);
  if (!Number.isSafeInteger(predecessorHeartbeatMs) || predecessorHeartbeatMs<0) {
    throw new Error('Real heartbeat plan requires predecessor lastHeartbeatMs from the observed initialize state.');
  }
  if (!Array.isArray(plan.protectedState?.predecessorApprovalKeyHashes) ||
      plan.protectedState.predecessorApprovalKeyHashes.length!==0) {
    throw new Error('First real heartbeat must consume the initialize state with no approvals.');
  }
  const stateInput=normalizeReference(plan.stateInput, 'heartbeatPlan.stateInput');
  const fundingInput=normalizeReference(plan.ownerFundingInput, 'heartbeatPlan.ownerFundingInput');
  const collateralInput=normalizeReference(plan.collateralInput, 'heartbeatPlan.collateralInput');
  if (new Set([
    `${stateInput.transaction.id}#${stateInput.index}`,
    `${fundingInput.transaction.id}#${fundingInput.index}`,
    `${collateralInput.transaction.id}#${collateralInput.index}`
  ]).size!==3) {
    throw new Error('Heartbeat state, funding and collateral references must remain distinct.');
  }
  return plan;
}

function validateRecoveryConfig(value, ownerKeyHash, plan) {
  const config=plainObject(value, 'recoveryConfig');
  const rescueKeyHash=keyHash(config.rescueKeyHash, 'recoveryConfig.rescueKeyHash');
  if (!Array.isArray(config.contactKeyHashes) || config.contactKeyHashes.length<1) {
    throw new TypeError('recoveryConfig.contactKeyHashes must contain at least one contact.');
  }
  const contactKeyHashes=config.contactKeyHashes.map((entry,index)=>keyHash(entry,`recoveryConfig.contactKeyHashes[${index}]`));
  if (new Set(contactKeyHashes).size!==contactKeyHashes.length) throw new Error('Recovery contacts must be unique.');
  if (contactKeyHashes.includes(ownerKeyHash)) throw new Error('Owner cannot also be a trusted contact.');
  if (contactKeyHashes.includes(rescueKeyHash)) throw new Error('Rescue destination cannot also be a trusted contact.');
  const threshold=cardanoPositiveSafeInteger(config.threshold,'Recovery threshold');
  if (threshold>contactKeyHashes.length) throw new Error('Recovery threshold must be reachable.');
  const inactivityMs=cardanoPositiveSafeInteger(config.inactivityMs,'Recovery inactivityMs');
  const stateLovelace=positiveBigInt(config.stateLovelace, 'recoveryConfig.stateLovelace');
  if (stateLovelace!==positiveBigInt(plan.protectedState.lovelace, 'heartbeatPlan.protectedState.lovelace')) {
    throw new Error('Recovery configuration protected lovelace differs from the observed heartbeat predecessor state.');
  }

  const predecessorDatum=createCardanoVaultDatumData({
    ownerKeyHash,
    rescueKeyHash,
    contactKeyHashes,
    threshold,
    inactivityMs,
    lastHeartbeatMs:plan.protectedState.predecessorLastHeartbeatMs,
    approvalKeyHashes:[]
  });
  if (hex(predecessorDatum.to_bytes())!==String(plan.protectedState.predecessorInlineDatumCborHex).toLowerCase()) {
    throw new Error('Recovery configuration does not reproduce the observed heartbeat predecessor datum.');
  }
  return Object.freeze({ rescueKeyHash, contactKeyHashes:Object.freeze(contactKeyHashes), threshold, inactivityMs, stateLovelace });
}

function constr0() {
  const list=Cardano.PlutusList.new();
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

function spendRedeemer(pointerIndex, memory, steps) {
  return Cardano.Redeemer.new(
    Cardano.RedeemerTag.new_spend(),
    Cardano.BigNum.from_str(String(pointerIndex)),
    constr0(),
    exUnits(memory, steps)
  );
}

function valueWithBeacon(lovelace, policyId, assetNameHex) {
  const value=Cardano.Value.new(Cardano.BigNum.from_str(String(lovelace)));
  const assets=Cardano.Assets.new();
  assets.insert(Cardano.AssetName.new(Uint8Array.from(Buffer.from(assetNameHex,'hex'))), Cardano.BigNum.one());
  const multiasset=Cardano.MultiAsset.new();
  multiasset.insert(Cardano.ScriptHash.from_hex(policyId), assets);
  value.set_multiasset(multiasset);
  return value;
}

function minimumAdaForOutput(output, parameters, label) {
  const actual=output.amount().coin().to_str();
  const required=calculateCardanoMinRequiredLovelace({
    serializedOutputBytes:output.to_bytes().length,
    coinsPerUtxoByte:parameters.coinsPerUtxoByte
  }).minimumLovelace;
  if (BigInt(actual)<BigInt(required)) throw new Error(`${label} is below minimum ADA.`);
  return Object.freeze({
    outputBytes:output.to_bytes().length,
    actualLovelace:actual,
    minimumLovelace:required,
    satisfied:true
  });
}

function fakeKeyWitness(witnessSet, body) {
  const clone=Cardano.TransactionWitnessSet.from_bytes(witnessSet.to_bytes());
  const bodyHash=Cardano.TransactionHash.from_bytes(blake2b(body.to_bytes(), { dkLen:32 }));
  const key=Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length:32 }, () => 1));
  const vkeys=Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash, key));
  clone.set_vkeys(vkeys);
  return clone;
}

export function buildCardanoPreprodRealHeartbeatCandidate({
  heartbeatPlan,
  appliedValidatorIdentity,
  parameters,
  recoveryConfig,
  stableTip,
  evaluationMode=true,
  spendBudget=null
}) {
  const identity=validateIdentity(appliedValidatorIdentity);
  const plan=validatePlan(heartbeatPlan, identity);
  if (!parameters?.independentlyConfirmed || parameters?.sourceCount<2) {
    throw new Error('Real heartbeat construction requires independently confirmed current Preprod protocol parameters.');
  }

  const tipHash=String(stableTip?.hash ?? '').toLowerCase();
  const tipSlot=Number(stableTip?.slot);
  if (!HEX_32.test(tipHash) || !Number.isSafeInteger(tipSlot) || tipSlot<30) {
    throw new Error('Real heartbeat construction requires a stable Preprod tip with hash and usable slot.');
  }
  if (tipSlot<Number(plan.predecessorObservedTip?.slot ?? 0)) {
    throw new Error('Heartbeat construction tip predates the observed predecessor state.');
  }

  const ownerKeyHash=keyHash(plan.ownerPaymentKeyHash, 'heartbeatPlan.ownerPaymentKeyHash');
  const config=validateRecoveryConfig(recoveryConfig, ownerKeyHash, plan);
  const fundingLovelace=positiveBigInt(plan.externalFunding?.fundingLovelace, 'heartbeatPlan.externalFunding.fundingLovelace');
  const collateralLovelace=positiveBigInt(plan.externalFunding?.collateralLovelace, 'heartbeatPlan.externalFunding.collateralLovelace');

  let memory=0n;
  let steps=0n;
  if (!evaluationMode) {
    memory=positiveBigInt(spendBudget?.memory, 'spendBudget.memory');
    steps=positiveBigInt(spendBudget?.steps, 'spendBudget.steps');
    if (memory>parameters.maxTxExUnits.memory || steps>parameters.maxTxExUnits.steps) {
      throw new Error('Evaluated heartbeat spend budget exceeds current maxTxExUnits.');
    }
  } else if (spendBudget!=null) {
    throw new Error('Evaluation-mode heartbeat candidates must keep the spend redeemer budget at zero.');
  }

  const lowerSlot=tipSlot-30;
  const upperSlot=tipSlot+CARDANO_PREPROD_EVALUATION_VALIDITY_WINDOW_SLOTS;
  const heartbeatMs=cardanoPreprodSlotToUnixTimeMs(lowerSlot);
  if (heartbeatMs<=plan.protectedState.predecessorLastHeartbeatMs) {
    throw new Error('Real heartbeat must advance lastHeartbeatMs beyond the predecessor state.');
  }

  const stateReference=normalizeReference(plan.stateInput, 'heartbeatPlan.stateInput');
  const fundingReference=normalizeReference(plan.ownerFundingInput, 'heartbeatPlan.ownerFundingInput');
  const sortedNormalInputs=[stateReference, fundingReference].sort(compareReferences);
  const expectedSpendIndex=sortedNormalInputs.findIndex(reference=>reference.transaction.id===stateReference.transaction.id && reference.index===stateReference.index);
  if (expectedSpendIndex<0) throw new Error('Heartbeat state input could not be assigned a spend redeemer pointer.');

  const recoveryScript=Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(identity.recoveryCode,'hex')));
  const redeemers=Cardano.Redeemers.new();
  redeemers.add(spendRedeemer(expectedSpendIndex, evaluationMode ? 0n : memory, evaluationMode ? 0n : steps));
  const scripts=Cardano.PlutusScripts.new();
  scripts.add(recoveryScript);
  const models=createCardanoPlutusV3CostModels(parameters.plutusV3CostModel);
  const scriptDataHash=Cardano.hash_script_data(redeemers, models).to_hex();
  const witnessSet=Cardano.TransactionWitnessSet.new();
  witnessSet.set_redeemers(redeemers);
  witnessSet.set_plutus_scripts(scripts);

  const stateAddress=Cardano.Address.from_bech32(identity.recoveryAddress);
  const ownerChangeAddress=Cardano.Address.from_bech32(plan.ownerFundingAddress);
  const collateralReturnAddress=Cardano.Address.from_bech32(plan.collateralAddress);
  if (ownerChangeAddress.network_id()!==CARDANO_PREPROD_NETWORK_ID || collateralReturnAddress.network_id()!==CARDANO_PREPROD_NETWORK_ID) {
    throw new Error('Heartbeat funding/collateral addresses must be Cardano Preprod addresses.');
  }

  const nextDatum=createCardanoVaultDatumData({
    ownerKeyHash,
    rescueKeyHash:config.rescueKeyHash,
    contactKeyHashes:config.contactKeyHashes,
    threshold:config.threshold,
    inactivityMs:config.inactivityMs,
    lastHeartbeatMs:heartbeatMs,
    approvalKeyHashes:[]
  });

  let fee=200000n;
  let transaction=null;
  let sizingBytes=0;
  let feeResult=null;
  let stateMinimumAda=null;
  let changeMinimumAda=null;
  let collateralReturnMinimumAda=null;
  let requiredCollateral=null;
  let changeLovelace=null;
  let collateralReturnLovelace=null;
  let iterations=0;

  for (let iteration=0; iteration<12; iteration+=1) {
    iterations=iteration+1;
    if (fundingLovelace<=fee) throw new Error('Owner funding UTxO cannot pay the heartbeat fee and preserve the protected state value.');
    changeLovelace=fundingLovelace-fee;

    const stateOutput=Cardano.TransactionOutput.new(
      stateAddress,
      valueWithBeacon(config.stateLovelace, identity.policyId, identity.assetNameHex)
    );
    stateOutput.set_plutus_data(nextDatum);
    stateMinimumAda=minimumAdaForOutput(stateOutput, parameters, 'Heartbeat continuing state output');

    const changeOutput=Cardano.TransactionOutput.new(
      ownerChangeAddress,
      Cardano.Value.new(Cardano.BigNum.from_str(changeLovelace.toString()))
    );
    changeMinimumAda=minimumAdaForOutput(changeOutput, parameters, 'Heartbeat owner change output');

    requiredCollateral=BigInt(calculateCardanoRequiredCollateral({
      feeLovelace:fee.toString(),
      parameters
    }).requiredCollateral);
    if (collateralLovelace<=requiredCollateral) throw new Error('Heartbeat collateral UTxO cannot satisfy collateral plus a return output.');
    collateralReturnLovelace=collateralLovelace-requiredCollateral;
    const collateralReturn=Cardano.TransactionOutput.new(
      collateralReturnAddress,
      Cardano.Value.new(Cardano.BigNum.from_str(collateralReturnLovelace.toString()))
    );
    collateralReturnMinimumAda=minimumAdaForOutput(collateralReturn, parameters, 'Heartbeat collateral return output');

    const inputs=Cardano.TransactionInputs.new();
    for (const reference of sortedNormalInputs) inputs.add(referenceInput(reference));
    const outputs=Cardano.TransactionOutputs.new();
    outputs.add(stateOutput);
    outputs.add(changeOutput);

    const body=Cardano.TransactionBody.new_tx_body(inputs, outputs, Cardano.BigNum.from_str(fee.toString()));
    body.set_network_id(Cardano.NetworkId.testnet());
    body.set_validity_start_interval_bignum(Cardano.BigNum.from_str(String(lowerSlot)));
    body.set_ttl(Cardano.BigNum.from_str(String(upperSlot)));
    body.set_script_data_hash(Cardano.ScriptDataHash.from_hex(scriptDataHash));

    const requiredSigners=Cardano.Ed25519KeyHashes.new();
    requiredSigners.add(Cardano.Ed25519KeyHash.from_hex(ownerKeyHash));
    body.set_required_signers(requiredSigners);

    const collateral=Cardano.TransactionInputs.new();
    collateral.add(referenceInput(normalizeReference(plan.collateralInput, 'heartbeatPlan.collateralInput')));
    body.set_collateral(collateral);
    body.set_total_collateral(Cardano.BigNum.from_str(requiredCollateral.toString()));
    body.set_collateral_return(collateralReturn);

    const actualSpendIndex=inputIndex(body, stateReference);
    if (actualSpendIndex!==expectedSpendIndex) {
      throw new Error('Cardano transaction input ordering changed the heartbeat spend redeemer pointer.');
    }

    const sizingWitnessSet=fakeKeyWitness(witnessSet, body);
    const sizingTransaction=Cardano.Transaction.new(body, sizingWitnessSet);
    sizingBytes=sizingTransaction.to_bytes().length;
    feeResult=calculateCardanoMinimumFee({
      transactionBytes:sizingBytes,
      memory,
      steps,
      parameters
    });
    transaction=Cardano.Transaction.new(body, witnessSet);
    const nextFee=BigInt(feeResult.minimumFee);
    if (nextFee===fee) break;
    fee=nextFee;
  }

  if (!transaction || !feeResult || BigInt(feeResult.minimumFee)!==fee) {
    throw new Error('Real heartbeat fee/collateral/change iteration did not converge.');
  }

  const txBytes=transaction.to_bytes();
  const roundTrip=Cardano.Transaction.from_bytes(txBytes).to_bytes();
  if (hex(txBytes)!==hex(roundTrip)) throw new Error('Real heartbeat unsigned transaction did not round-trip canonically.');
  if (transaction.witness_set().vkeys()!=null) throw new Error('Real heartbeat candidate unexpectedly contains a wallet key witness.');
  if (transaction.body().mint()!=null) throw new Error('Heartbeat candidate must not mint or burn the state beacon.');

  const bodyHash=hex(blake2b(transaction.body().to_bytes(), { dkLen:32 }));
  const evaluationRequest=evaluationMode
    ? createCardanoOgmiosEvaluationRequest({
        transactionCborHex:hex(txBytes),
        id:'omegavault-cardano-preprod-real-heartbeat-evaluate'
      })
    : null;
  const expectedValidators=Object.freeze([`spend:${expectedSpendIndex}`]);
  if (evaluationRequest &&
      (evaluationRequest.expectedValidators.length!==1 || evaluationRequest.expectedValidators[0]!==expectedValidators[0])) {
    throw new Error('Real heartbeat evaluation candidate exposed an unexpected spend redeemer pointer.');
  }

  const core=Object.freeze({
    schema:'omegavault.cardano.preprod-real-heartbeat-candidate.v1',
    network:'preprod',
    action:'heartbeat',
    heartbeatPlanSha256:plan.planSha256,
    validatorIdentitySha256:identity.identitySha256,
    stableTip:Object.freeze({ hash:tipHash, slot:tipSlot }),
    predecessorStateObservationSha256:plan.predecessorStateObservationSha256,
    ownerPaymentKeyHash:ownerKeyHash,
    validity:Object.freeze({
      lowerSlot,
      upperSlot,
      predecessorHeartbeatMs:plan.protectedState.predecessorLastHeartbeatMs,
      nextHeartbeatMs:heartbeatMs
    }),
    stateTransition:Object.freeze({
      stateInput:plan.stateInput,
      continuingStateAddress:identity.recoveryAddress,
      protectedLovelace:config.stateLovelace.toString(),
      beaconPolicyId:identity.policyId,
      beaconAssetNameHex:identity.assetNameHex,
      beaconQuantity:'1',
      predecessorApprovals:Object.freeze([]),
      nextApprovals:Object.freeze([]),
      protectedValueUsedForFees:false
    }),
    transaction:Object.freeze({
      bodyHash,
      cborHex:hex(txBytes),
      bytes:txBytes.length,
      feeSizingBytes:sizingBytes,
      feeLovelace:fee.toString(),
      scriptDataHash,
      spendRedeemerPointer:`spend:${expectedSpendIndex}`,
      ownerFundingLovelace:fundingLovelace.toString(),
      ownerChangeLovelace:changeLovelace.toString(),
      collateralLovelace:collateralLovelace.toString(),
      totalCollateral:requiredCollateral.toString(),
      collateralReturnLovelace:collateralReturnLovelace.toString(),
      keyWitnessCount:0,
      expectedKeyWitnessCountForFeeSizing:1,
      feeConvergenceIterations:iterations
    }),
    checks:Object.freeze({
      predecessorStateBound:true,
      immutableValidatorAddressPreserved:true,
      immutableBeaconPreserved:true,
      protectedLovelacePreserved:true,
      approvalsCleared:true,
      heartbeatAdvanced:true,
      feePaidOnlyFromExternalOwnerFunding:true,
      stateMinimumAda,
      changeMinimumAda,
      collateralReturnMinimumAda,
      collateralRequirementSatisfied:collateralLovelace===requiredCollateral+collateralReturnLovelace,
      currentProtocolParametersIndependentlyConfirmed:true,
      walletWitnessesValidated:false,
      fullPhaseOneValidated:false
    }),
    evaluation:Object.freeze({
      mode:evaluationMode ? 'zero-budget-live-evaluation-candidate' : 'live-budget-applied-unsigned-candidate',
      spendBudget:Object.freeze({ memory:memory.toString(), steps:steps.toString() }),
      request:evaluationRequest?.request ?? null,
      expectedValidators,
      requiresLiveEvaluation:evaluationMode,
      evaluationSupplementalUtxoRequired:false
    }),
    liveActions:Object.freeze({
      walletSigningAuthorized:false,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    nextGate:evaluationMode
      ? 'evaluate-exact-real-heartbeat-candidate-at-a-stable-preprod-tip'
      : 'verify-live-budget-applied-heartbeat-and-complete-wallet-witness-policy-before-any-signing',
    authorityBoundary:'This candidate consumes the exact observed recovery state plus external owner funding, preserves the protected state value/beacon, advances heartbeat liveness and clears approvals. It is unsigned and does not authorize signing, submission, recovery or support promotion. Structural checks and Ogmios evaluation do not constitute complete Cardano phase-1 validation.'
  });

  return Object.freeze({ ...core, candidateSha256:hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodRealHeartbeatCandidate({
  candidate,
  ...inputs
}) {
  if (!candidate || typeof candidate!=='object' || Array.isArray(candidate)) {
    return Object.freeze({ valid:false, errors:Object.freeze(['Real Cardano heartbeat candidate is required.']), recomputedSha256:null });
  }
  const errors=[];
  let recomputed;
  try {
    recomputed=buildCardanoPreprodRealHeartbeatCandidate(inputs);
  } catch (error) {
    return Object.freeze({ valid:false, errors:Object.freeze([error.message]), recomputedSha256:null });
  }
  if (!HEX_32.test(String(candidate.candidateSha256 ?? '')) ||
      hashCardanoEvidence(withoutDigest(candidate, 'candidateSha256'))!==candidate.candidateSha256) {
    errors.push('Real Cardano heartbeat candidate self-digest mismatch.');
  }
  if (candidate.candidateSha256!==recomputed.candidateSha256) {
    errors.push('Real Cardano heartbeat candidate does not reproduce from its bound plan, validator identity, protocol parameters and stable tip.');
  }
  return Object.freeze({ valid:errors.length===0, errors:Object.freeze(errors), recomputedSha256:recomputed.candidateSha256 });
}
