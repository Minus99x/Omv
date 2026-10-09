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

const HEX_28=/^[0-9a-f]{56}$/i;
const HEX_32=/^[0-9a-f]{64}$/i;

function hex(value){ return Buffer.from(value).toString('hex'); }
function withoutDigest(value,key){ return Object.fromEntries(Object.entries(value).filter(([name])=>name!==key)); }

function plainObject(value,label){
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function positiveBigInt(value,label){
  const normalized=String(value);
  if(!/^\d+$/.test(normalized) || BigInt(normalized)<1n) throw new TypeError(`${label} must be a positive integer.`);
  return BigInt(normalized);
}

function keyHash(value,label){
  const normalized=String(value ?? '').toLowerCase();
  if(!HEX_28.test(normalized)) throw new TypeError(`${label} must be 28-byte hex.`);
  return normalized;
}

function normalizeReference(value,label){
  const id=String(value?.transaction?.id ?? '').toLowerCase();
  const index=Number(value?.index);
  if(!HEX_32.test(id)) throw new TypeError(`${label}.transaction.id must be 32-byte hex.`);
  if(!Number.isSafeInteger(index) || index<0) throw new TypeError(`${label}.index must be a non-negative safe integer.`);
  return Object.freeze({ transaction:Object.freeze({ id }),index });
}

function referenceInput(reference){
  return Cardano.TransactionInput.new(Cardano.TransactionHash.from_hex(reference.transaction.id),reference.index);
}

function compareReferences(left,right){
  if(left.transaction.id<right.transaction.id) return -1;
  if(left.transaction.id>right.transaction.id) return 1;
  return left.index-right.index;
}

function sameReference(input,reference){
  return input.transaction_id().to_hex()===reference.transaction.id && input.index()===reference.index;
}

function inputIndex(body,reference){
  const inputs=body.inputs();
  for(let index=0;index<inputs.len();index+=1) if(sameReference(inputs.get(index),reference)) return index;
  return -1;
}

function enterpriseKeyAddressFromHash(hash){
  return Cardano.EnterpriseAddress.new(
    CARDANO_PREPROD_NETWORK_ID,
    Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(hash))
  ).to_address();
}

function validateIdentity(value){
  const identity=plainObject(value,'appliedValidatorIdentity');
  const verification=verifyCardanoPreprodAppliedValidatorIdentity(identity);
  if(!verification.valid) throw new Error(`Applied validator identity verification failed: ${verification.errors.join('; ')}`);
  if(identity.network!=='preprod' || identity.networkId!==CARDANO_PREPROD_NETWORK_ID) throw new Error('Execute requires Cardano Preprod validator identity.');

  const recoveryAddress=String(identity.recoveryVault?.address ?? '');
  const recoveryHash=String(identity.recoveryVault?.scriptHash ?? '').toLowerCase();
  const recoveryCode=String(identity.recoveryVault?.compiledCode ?? '');
  const policyId=String(identity.stateBeacon?.policyId ?? '').toLowerCase();
  const beaconCode=String(identity.stateBeacon?.compiledCode ?? '');
  const assetNameHex=String(identity.assetNameHex ?? '').toLowerCase();
  if(!HEX_28.test(recoveryHash) || !HEX_28.test(policyId) || !recoveryCode || !beaconCode) throw new Error('Applied validator identity is missing execute script identity fields.');

  const recoveryScript=Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(recoveryCode,'hex')));
  const beaconScript=Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(beaconCode,'hex')));
  if(recoveryScript.hash().to_hex()!==recoveryHash) throw new Error('Applied recovery compiled code does not hash to its validator hash.');
  if(beaconScript.hash().to_hex()!==policyId) throw new Error('Applied beacon compiled code does not hash to its policy id.');

  const decoded=Cardano.Address.from_bech32(recoveryAddress);
  if(decoded.network_id()!==CARDANO_PREPROD_NETWORK_ID) throw new Error('Applied recovery address is not Cardano Preprod.');

  return Object.freeze({
    identitySha256:identity.identitySha256,
    recoveryAddress,
    recoveryHash,
    recoveryCode,
    policyId,
    beaconCode,
    assetNameHex
  });
}

function validatePlan(value,identity){
  const plan=plainObject(value,'executePlan');
  if(plan.schema!=='omegavault.cardano.preprod-real-execute-plan.v1' ||
      plan.network!=='preprod' ||
      plan.action!=='execute' ||
      plan.liveActions?.walletSigningAuthorized!==false ||
      plan.liveActions?.transactionSubmissionAuthorized!==false ||
      plan.liveActions?.supportClaimAuthorized!==false) {
    throw new Error('A fail-closed real Cardano execute plan is required.');
  }
  if(!HEX_32.test(String(plan.planSha256 ?? '')) || hashCardanoEvidence(withoutDigest(plan,'planSha256'))!==plan.planSha256) {
    throw new Error('Real execute plan self-digest mismatch.');
  }
  if(plan.validatorIdentitySha256!==identity.identitySha256) throw new Error('Real execute plan is bound to a different validator identity.');
  if(plan.protectedState?.address!==identity.recoveryAddress ||
      plan.protectedState?.beaconPolicyId!==identity.policyId ||
      plan.protectedState?.beaconAssetNameHex!==identity.assetNameHex ||
      plan.protectedState?.beaconQuantity!=='1') {
    throw new Error('Real execute plan protected-state identity does not match the applied validator.');
  }
  if(plan.executionRequirements?.thresholdAlreadyReached!==true ||
      plan.executionRequirements?.inactivityStillRequiredAtExecution!==true ||
      plan.executionRequirements?.stateBeaconMustBurnExactlyOnce!==true ||
      plan.executionRequirements?.continuingStateForbidden!==true ||
      plan.executionRequirements?.exactProtectedValueToImmutableRescue!==true) {
    throw new Error('Real execute plan is missing immutable-rescue execution requirements.');
  }
  return plan;
}

function validateRecoveryConfig(value,plan){
  const config=plainObject(value,'recoveryConfig');
  const owner=keyHash(config.ownerPaymentKeyHash,'recoveryConfig.ownerPaymentKeyHash');
  const rescue=keyHash(config.rescueKeyHash,'recoveryConfig.rescueKeyHash');
  const contacts=(config.contactKeyHashes ?? []).map((entry,index)=>keyHash(entry,`recoveryConfig.contactKeyHashes[${index}]`));
  if(!contacts.length || new Set(contacts).size!==contacts.length) throw new Error('Recovery contacts must be unique and non-empty.');
  const threshold=Number(config.threshold);
  if(!Number.isInteger(threshold) || threshold<1 || threshold>contacts.length) throw new Error('Recovery threshold must be reachable.');
  const inactivityMs=Number(config.inactivityMs);
  if(!Number.isSafeInteger(inactivityMs) || inactivityMs<1) throw new Error('Recovery inactivityMs must be positive.');
  const stateLovelace=positiveBigInt(config.stateLovelace,'recoveryConfig.stateLovelace');

  const ps=plan.protectedState;
  if(owner!==ps.ownerPaymentKeyHash || rescue!==ps.rescueKeyHash ||
      threshold!==ps.threshold || inactivityMs!==ps.inactivityMs ||
      stateLovelace!==positiveBigInt(ps.lovelace,'executePlan.protectedState.lovelace') ||
      contacts.length!==ps.contactKeyHashes.length ||
      contacts.some((entry,index)=>entry!==ps.contactKeyHashes[index])) {
    throw new Error('Recovery configuration differs from the immutable execute predecessor policy.');
  }

  const approvals=(ps.approvalKeyHashes ?? []).map((entry,index)=>keyHash(entry,`executePlan.protectedState.approvalKeyHashes[${index}]`));
  if(approvals.length<threshold || new Set(approvals).size!==approvals.length || approvals.some(entry=>!contacts.includes(entry))) {
    throw new Error('Execute predecessor approvals do not satisfy the immutable recovery threshold.');
  }

  const predecessorDatum=createCardanoVaultDatumData({
    ownerKeyHash:owner,
    rescueKeyHash:rescue,
    contactKeyHashes:contacts,
    threshold,
    inactivityMs,
    lastHeartbeatMs:ps.lastHeartbeatMs,
    approvalKeyHashes:approvals
  });
  if(hex(predecessorDatum.to_bytes())!==String(ps.predecessorInlineDatumCborHex).toLowerCase()) {
    throw new Error('Recovery configuration does not reproduce the execute predecessor datum.');
  }

  return Object.freeze({
    owner,
    rescue,
    contacts:Object.freeze(contacts),
    approvals:Object.freeze(approvals),
    threshold,
    inactivityMs,
    stateLovelace
  });
}

function plutusConstr(alternative,fields=[]){
  const list=Cardano.PlutusList.new();
  for(const field of fields) list.add(field);
  return Cardano.PlutusData.new_constr_plutus_data(
    Cardano.ConstrPlutusData.new(Cardano.BigNum.from_str(String(alternative)),list)
  );
}

function exUnits(memory,steps){
  return Cardano.ExUnits.new(Cardano.BigNum.from_str(String(memory)),Cardano.BigNum.from_str(String(steps)));
}

function redeemer(tag,index,data,memory,steps){
  return Cardano.Redeemer.new(
    tag,
    Cardano.BigNum.from_str(String(index)),
    data,
    exUnits(memory,steps)
  );
}

function setBeaconBurn(body,policyId,assetNameHex){
  const assets=Cardano.MintAssets.new();
  assets.insert(
    Cardano.AssetName.new(Uint8Array.from(Buffer.from(assetNameHex,'hex'))),
    Cardano.Int.from_str('-1')
  );
  const mint=Cardano.Mint.new();
  mint.insert(Cardano.ScriptHash.from_hex(policyId),assets);
  body.set_mint(mint);
}

function minimumAdaForOutput(output,parameters,label){
  const actual=output.amount().coin().to_str();
  const required=calculateCardanoMinRequiredLovelace({
    serializedOutputBytes:output.to_bytes().length,
    coinsPerUtxoByte:parameters.coinsPerUtxoByte
  }).minimumLovelace;
  if(BigInt(actual)<BigInt(required)) throw new Error(`${label} is below minimum ADA.`);
  return Object.freeze({ outputBytes:output.to_bytes().length,actualLovelace:actual,minimumLovelace:required,satisfied:true });
}

function fakeKeyWitness(witnessSet,body){
  const clone=Cardano.TransactionWitnessSet.from_bytes(witnessSet.to_bytes());
  const bodyHash=Cardano.TransactionHash.from_bytes(blake2b(body.to_bytes(),{ dkLen:32 }));
  const key=Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length:32 },()=>1));
  const vkeys=Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash,key));
  clone.set_vkeys(vkeys);
  return clone;
}

export function buildCardanoPreprodRealExecuteCandidate({
  executePlan,
  appliedValidatorIdentity,
  parameters,
  recoveryConfig,
  stableTip,
  evaluationMode=true,
  spendBudget=null,
  mintBudget=null
}){
  const identity=validateIdentity(appliedValidatorIdentity);
  const plan=validatePlan(executePlan,identity);
  if(!parameters?.independentlyConfirmed || parameters?.sourceCount<2) throw new Error('Real execute construction requires independently confirmed current Preprod protocol parameters.');

  const tipHash=String(stableTip?.hash ?? '').toLowerCase();
  const tipSlot=Number(stableTip?.slot);
  if(!HEX_32.test(tipHash) || !Number.isSafeInteger(tipSlot) || tipSlot<30) throw new Error('Real execute construction requires a stable Preprod tip.');
  if(tipSlot<Number(plan.predecessorObservedTip?.slot ?? 0)) throw new Error('Execute construction tip predates the observed predecessor state.');

  const config=validateRecoveryConfig(recoveryConfig,plan);
  const lowerSlot=tipSlot-30;
  const upperSlot=tipSlot+CARDANO_PREPROD_EVALUATION_VALIDITY_WINDOW_SLOTS;
  const lowerTimeMs=cardanoPreprodSlotToUnixTimeMs(lowerSlot);
  if(lowerTimeMs<plan.protectedState.lastHeartbeatMs+plan.protectedState.inactivityMs) {
    throw new Error('Recovery inactivity period has not elapsed for execute.');
  }

  let spendMemory=0n;
  let spendSteps=0n;
  let mintMemory=0n;
  let mintSteps=0n;
  if(!evaluationMode){
    spendMemory=positiveBigInt(spendBudget?.memory,'spendBudget.memory');
    spendSteps=positiveBigInt(spendBudget?.steps,'spendBudget.steps');
    mintMemory=positiveBigInt(mintBudget?.memory,'mintBudget.memory');
    mintSteps=positiveBigInt(mintBudget?.steps,'mintBudget.steps');
    if(spendMemory+mintMemory>parameters.maxTxExUnits.memory || spendSteps+mintSteps>parameters.maxTxExUnits.steps) {
      throw new Error('Evaluated execute budgets exceed current maxTxExUnits.');
    }
  } else if(spendBudget!=null || mintBudget!=null) {
    throw new Error('Evaluation-mode execute candidates must keep spend and mint redeemer budgets at zero.');
  }

  const stateReference=normalizeReference(plan.stateInput,'executePlan.stateInput');
  const fundingReference=normalizeReference(plan.executorFundingInput,'executePlan.executorFundingInput');
  const collateralReference=normalizeReference(plan.executorCollateralInput,'executePlan.executorCollateralInput');
  const sortedInputs=[stateReference,fundingReference].sort(compareReferences);
  const spendIndex=sortedInputs.findIndex(reference=>reference.transaction.id===stateReference.transaction.id && reference.index===stateReference.index);
  if(spendIndex<0) throw new Error('Execute state input could not be assigned a spend redeemer pointer.');

  const recoveryScript=Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(identity.recoveryCode,'hex')));
  const beaconScript=Cardano.PlutusScript.new_v3(Uint8Array.from(Buffer.from(identity.beaconCode,'hex')));
  const redeemers=Cardano.Redeemers.new();
  redeemers.add(redeemer(Cardano.RedeemerTag.new_spend(),spendIndex,plutusConstr(2),evaluationMode?0n:spendMemory,evaluationMode?0n:spendSteps));
  redeemers.add(redeemer(Cardano.RedeemerTag.new_mint(),0,plutusConstr(0),evaluationMode?0n:mintMemory,evaluationMode?0n:mintSteps));
  const scripts=Cardano.PlutusScripts.new();
  scripts.add(recoveryScript);
  scripts.add(beaconScript);
  const models=createCardanoPlutusV3CostModels(parameters.plutusV3CostModel);
  const scriptDataHash=Cardano.hash_script_data(redeemers,models).to_hex();
  const witnessSet=Cardano.TransactionWitnessSet.new();
  witnessSet.set_redeemers(redeemers);
  witnessSet.set_plutus_scripts(scripts);

  const rescueAddress=enterpriseKeyAddressFromHash(config.rescue);
  const feePayerAddress=Cardano.Address.from_bech32(plan.executorFundingAddress);
  const collateralReturnAddress=Cardano.Address.from_bech32(plan.executorCollateralAddress);
  if(feePayerAddress.network_id()!==CARDANO_PREPROD_NETWORK_ID || collateralReturnAddress.network_id()!==CARDANO_PREPROD_NETWORK_ID) {
    throw new Error('Execute fee funding/collateral addresses must be Cardano Preprod addresses.');
  }

  const fundingLovelace=positiveBigInt(plan.externalFunding.fundingLovelace,'executePlan.externalFunding.fundingLovelace');
  const collateralLovelace=positiveBigInt(plan.externalFunding.collateralLovelace,'executePlan.externalFunding.collateralLovelace');
  const feePayerKeyHash=keyHash(plan.feePayerKeyHash,'executePlan.feePayerKeyHash');

  let fee=200000n;
  let transaction=null;
  let feeResult=null;
  let sizingBytes=0;
  let rescueMinimumAda=null;
  let changeMinimumAda=null;
  let collateralReturnMinimumAda=null;
  let requiredCollateral=null;
  let changeLovelace=null;
  let collateralReturnLovelace=null;
  let iterations=0;

  for(let iteration=0;iteration<12;iteration+=1){
    iterations=iteration+1;
    if(fundingLovelace<=fee) throw new Error('External execute funding cannot pay the fee while preserving protected value.');
    changeLovelace=fundingLovelace-fee;

    const rescueOutput=Cardano.TransactionOutput.new(
      rescueAddress,
      Cardano.Value.new(Cardano.BigNum.from_str(config.stateLovelace.toString()))
    );
    rescueMinimumAda=minimumAdaForOutput(rescueOutput,parameters,'Execute immutable rescue output');

    const changeOutput=Cardano.TransactionOutput.new(
      feePayerAddress,
      Cardano.Value.new(Cardano.BigNum.from_str(changeLovelace.toString()))
    );
    changeMinimumAda=minimumAdaForOutput(changeOutput,parameters,'Execute fee-payer change output');

    requiredCollateral=BigInt(calculateCardanoRequiredCollateral({ feeLovelace:fee.toString(),parameters }).requiredCollateral);
    if(collateralLovelace<=requiredCollateral) throw new Error('Execute collateral cannot satisfy collateral plus return.');
    collateralReturnLovelace=collateralLovelace-requiredCollateral;
    const collateralReturn=Cardano.TransactionOutput.new(
      collateralReturnAddress,
      Cardano.Value.new(Cardano.BigNum.from_str(collateralReturnLovelace.toString()))
    );
    collateralReturnMinimumAda=minimumAdaForOutput(collateralReturn,parameters,'Execute collateral return output');

    const inputs=Cardano.TransactionInputs.new();
    for(const reference of sortedInputs) inputs.add(referenceInput(reference));
    const outputs=Cardano.TransactionOutputs.new();
    outputs.add(rescueOutput);
    outputs.add(changeOutput);

    const body=Cardano.TransactionBody.new_tx_body(inputs,outputs,Cardano.BigNum.from_str(fee.toString()));
    body.set_network_id(Cardano.NetworkId.testnet());
    body.set_validity_start_interval_bignum(Cardano.BigNum.from_str(String(lowerSlot)));
    body.set_ttl(Cardano.BigNum.from_str(String(upperSlot)));
    body.set_script_data_hash(Cardano.ScriptDataHash.from_hex(scriptDataHash));
    setBeaconBurn(body,identity.policyId,identity.assetNameHex);

    const signers=Cardano.Ed25519KeyHashes.new();
    signers.add(Cardano.Ed25519KeyHash.from_hex(feePayerKeyHash));
    body.set_required_signers(signers);

    const collateral=Cardano.TransactionInputs.new();
    collateral.add(referenceInput(collateralReference));
    body.set_collateral(collateral);
    body.set_total_collateral(Cardano.BigNum.from_str(requiredCollateral.toString()));
    body.set_collateral_return(collateralReturn);

    if(inputIndex(body,stateReference)!==spendIndex) throw new Error('Cardano input ordering changed the execute spend redeemer pointer.');

    const sizingWitnessSet=fakeKeyWitness(witnessSet,body);
    const sizingTransaction=Cardano.Transaction.new(body,sizingWitnessSet);
    sizingBytes=sizingTransaction.to_bytes().length;
    feeResult=calculateCardanoMinimumFee({
      transactionBytes:sizingBytes,
      memory:spendMemory+mintMemory,
      steps:spendSteps+mintSteps,
      parameters
    });
    transaction=Cardano.Transaction.new(body,witnessSet);
    const nextFee=BigInt(feeResult.minimumFee);
    if(nextFee===fee) break;
    fee=nextFee;
  }

  if(!transaction || !feeResult || BigInt(feeResult.minimumFee)!==fee) throw new Error('Real execute fee/collateral/change iteration did not converge.');
  const txBytes=transaction.to_bytes();
  if(hex(Cardano.Transaction.from_bytes(txBytes).to_bytes())!==hex(txBytes)) throw new Error('Real execute unsigned transaction did not round-trip canonically.');
  if(transaction.witness_set().vkeys()!=null) throw new Error('Real execute candidate unexpectedly contains a wallet key witness.');
  if(transaction.body().outputs().len()!==2) throw new Error('Execute candidate must contain exactly immutable rescue and external change outputs.');

  const bodyHash=hex(blake2b(transaction.body().to_bytes(),{ dkLen:32 }));
  const evaluationRequest=evaluationMode ? createCardanoOgmiosEvaluationRequest({
    transactionCborHex:hex(txBytes),
    id:'omegavault-cardano-preprod-real-execute-evaluate'
  }) : null;
  const expectedValidators=Object.freeze([`mint:0`,`spend:${spendIndex}`].sort());
  if(evaluationRequest) {
    const actual=[...evaluationRequest.expectedValidators].sort();
    if(actual.length!==expectedValidators.length || actual.some((entry,index)=>entry!==expectedValidators[index])) {
      throw new Error('Real execute evaluation candidate exposed unexpected redeemer pointers.');
    }
  }

  const core=Object.freeze({
    schema:'omegavault.cardano.preprod-real-execute-candidate.v1',
    network:'preprod',
    action:'execute',
    executePlanSha256:plan.planSha256,
    validatorIdentitySha256:identity.identitySha256,
    predecessorStateEvidenceSha256:plan.predecessorStateEvidenceSha256,
    stableTip:Object.freeze({ hash:tipHash,slot:tipSlot }),
    validity:Object.freeze({ lowerSlot,upperSlot,lowerTimeMs,inactivityEligible:true }),
    recovery:Object.freeze({
      immutableRescueAddress:rescueAddress.to_bech32(),
      protectedLovelace:config.stateLovelace.toString(),
      stateBeaconPolicyId:identity.policyId,
      stateBeaconAssetNameHex:identity.assetNameHex,
      stateBeaconBurnQuantity:'-1',
      continuingStateOutputCount:0,
      exactProtectedValueDirectedToRescue:true,
      protectedValueUsedForFees:false
    }),
    transaction:Object.freeze({
      bodyHash,
      cborHex:hex(txBytes),
      bytes:txBytes.length,
      feeSizingBytes:sizingBytes,
      feeLovelace:fee.toString(),
      scriptDataHash,
      spendRedeemerPointer:`spend:${spendIndex}`,
      mintRedeemerPointer:'mint:0',
      requiredFeePayerSigner:feePayerKeyHash,
      externalFundingLovelace:fundingLovelace.toString(),
      externalChangeLovelace:changeLovelace.toString(),
      collateralLovelace:collateralLovelace.toString(),
      totalCollateral:requiredCollateral.toString(),
      collateralReturnLovelace:collateralReturnLovelace.toString(),
      keyWitnessCount:0,
      expectedKeyWitnessCountForFeeSizing:1,
      feeConvergenceIterations:iterations
    }),
    checks:Object.freeze({
      predecessorStateBound:true,
      thresholdSatisfied:config.approvals.length>=config.threshold,
      inactivitySatisfied:true,
      immutableRescueDestinationPreserved:true,
      exactProtectedLovelaceToRescue:true,
      stateBeaconBurnedExactlyOnce:true,
      continuingStateForbidden:true,
      feeExternalized:true,
      rescueMinimumAda,
      changeMinimumAda,
      collateralReturnMinimumAda,
      collateralRequirementSatisfied:collateralLovelace===requiredCollateral+collateralReturnLovelace,
      currentProtocolParametersIndependentlyConfirmed:true,
      walletWitnessesValidated:false,
      fullPhaseOneValidated:false
    }),
    evaluation:Object.freeze({
      mode:evaluationMode?'zero-budget-live-evaluation-candidate':'live-budget-applied-unsigned-candidate',
      spendBudget:Object.freeze({ memory:spendMemory.toString(),steps:spendSteps.toString() }),
      mintBudget:Object.freeze({ memory:mintMemory.toString(),steps:mintSteps.toString() }),
      request:evaluationRequest?.request ?? null,
      expectedValidators,
      requiresLiveEvaluation:evaluationMode
    }),
    liveActions:Object.freeze({
      walletSigningAuthorized:false,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    nextGate:evaluationMode
      ? 'evaluate-exact-real-execute-candidate-at-a-stable-preprod-tip'
      : 'verify-live-budget-applied-execute-and-wallet-witness-policy-before-any-signing',
    authorityBoundary:'This unsigned execute candidate can only pay the protected state lovelace to the immutable rescue key and burns the state beacon without recreating active state. Fees/collateral are external. It does not authorize signing or submission and does not prove phase-1 validity, finality, public recovery or support.'
  });

  return Object.freeze({ ...core,candidateSha256:hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodRealExecuteCandidate({ candidate,...inputs }){
  if(!candidate || typeof candidate!=='object' || Array.isArray(candidate)) {
    return Object.freeze({ valid:false,errors:Object.freeze(['Real Cardano execute candidate is required.']),recomputedSha256:null });
  }
  const errors=[];
  let recomputed;
  try { recomputed=buildCardanoPreprodRealExecuteCandidate(inputs); }
  catch(error){ return Object.freeze({ valid:false,errors:Object.freeze([error.message]),recomputedSha256:null }); }
  if(!HEX_32.test(String(candidate.candidateSha256 ?? '')) || hashCardanoEvidence(withoutDigest(candidate,'candidateSha256'))!==candidate.candidateSha256) {
    errors.push('Real Cardano execute candidate self-digest mismatch.');
  }
  if(candidate.candidateSha256!==recomputed.candidateSha256) errors.push('Real Cardano execute candidate does not reproduce from its bound plan, validator identity, protocol parameters and stable tip.');
  return Object.freeze({ valid:errors.length===0,errors:Object.freeze(errors),recomputedSha256:recomputed.candidateSha256 });
}
