import { hashCardanoEvidence } from './evidence-binding.js';
import { cardanoPreprodPaymentKeyHashFromAddress } from './preprod-recovery-config.js';
import { cardanoPositiveSafeInteger } from './policy-integer.js';

const HEX_28=/^[0-9a-f]{56}$/i;
const HEX_32=/^[0-9a-f]{64}$/i;

function withoutDigest(value,key){ return Object.fromEntries(Object.entries(value).filter(([name])=>name!==key)); }

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

function referenceKey(reference){ return `${reference.transaction.id}#${reference.index}`; }

function plainAdaOnlyRole(value,label,expectedKeyHash){
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError(`${label} UTxO is required.`);
  const reference=normalizeReference(value,label);
  const address=String(value.address ?? '');
  const paymentKeyHash=cardanoPreprodPaymentKeyHashFromAddress(address,`${label}.address`);
  if(paymentKeyHash!==expectedKeyHash) throw new Error(`${label} UTxO is not controlled by the configured execution fee payer.`);
  const topKeys=Object.keys(value.value ?? {});
  if(topKeys.length!==1 || topKeys[0]!=='ada') throw new Error(`${label} UTxO must be plain ADA-only.`);
  const lovelace=String(value.value?.ada?.lovelace ?? '');
  if(!/^\d+$/.test(lovelace) || BigInt(lovelace)<1n) throw new TypeError(`${label} UTxO lovelace must be a positive integer.`);
  if(value.datum!=null || value.datumHash!=null) throw new Error(`${label} UTxO must not contain datum material.`);
  if(value.script!=null) throw new Error(`${label} UTxO must not contain a reference script.`);
  return Object.freeze({ reference,address,paymentKeyHash,lovelace });
}

function verifiedPredecessor(value,expectedSha256){
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError('Threshold-approved predecessor state evidence is required.');
  if(!HEX_32.test(String(expectedSha256 ?? ''))) throw new TypeError('expectedPredecessorStateSha256 must be 32-byte hex.');
  if(value.schema!=='omegavault.cardano.preprod-active-state-evidence.v1' ||
      value.network!=='preprod' ||
      value.sourceAction!=='approve' ||
      value.checks?.inclusionObserved!==true ||
      value.checks?.exactActiveStateObserved!==true ||
      value.liveActions?.transactionSubmissionPerformed!==true ||
      value.liveActions?.supportClaimAuthorized!==false ||
      value.liveActions?.publicNetworkRecoveryProven!==false) {
    throw new Error('Execute predecessor evidence is not an included approved active-state record.');
  }
  if(value.stateEvidenceSha256!==String(expectedSha256).toLowerCase()) throw new Error('Execute predecessor digest does not match explicitly selected state evidence.');
  if(hashCardanoEvidence(withoutDigest(value,'stateEvidenceSha256'))!==value.stateEvidenceSha256) throw new Error('Execute predecessor active-state evidence self-digest mismatch.');
  return value;
}

export function createCardanoPreprodRealExecutePlan({
  predecessorStateEvidence,
  expectedPredecessorStateSha256,
  feePayerKeyHash,
  executorFundingUtxo,
  executorCollateralUtxo
}){
  const predecessor=verifiedPredecessor(predecessorStateEvidence,expectedPredecessorStateSha256);
  const payer=keyHash(feePayerKeyHash,'feePayerKeyHash');
  const owner=keyHash(predecessor.state?.ownerPaymentKeyHash,'predecessorStateEvidence.state.ownerPaymentKeyHash');
  const rescue=keyHash(predecessor.state?.rescueKeyHash,'predecessorStateEvidence.state.rescueKeyHash');
  const contacts=(predecessor.state?.contactKeyHashes ?? []).map((entry,index)=>keyHash(entry,`predecessorStateEvidence.state.contactKeyHashes[${index}]`));
  const approvals=(predecessor.state?.approvalKeyHashes ?? []).map((entry,index)=>keyHash(entry,`predecessorStateEvidence.state.approvalKeyHashes[${index}]`));
  const threshold=cardanoPositiveSafeInteger(predecessor.state?.threshold,'Execute predecessor threshold');
  const inactivityMs=cardanoPositiveSafeInteger(predecessor.state?.inactivityMs,'Execute predecessor inactivity interval');

  if(!contacts.length || new Set(contacts).size!==contacts.length) throw new Error('Execute predecessor contact set is invalid.');
  if(threshold>contacts.length) throw new Error('Execute predecessor threshold is invalid.');
  if(new Set(approvals).size!==approvals.length || approvals.some(entry=>!contacts.includes(entry))) throw new Error('Execute predecessor approvals are invalid.');
  if(approvals.length<threshold) throw new Error('Execute predecessor has not reached the configured approval threshold.');
  if(!Number.isSafeInteger(predecessor.state?.lastHeartbeatMs) || predecessor.state.lastHeartbeatMs<0) throw new Error('Execute predecessor is missing lastHeartbeatMs.');
  if(String(predecessor.state?.beaconQuantity)!=='1') throw new Error('Execute predecessor must carry exactly one state beacon.');
  if(!HEX_32.test(String(predecessor.validatorIdentitySha256 ?? ''))) throw new Error('Execute predecessor is missing validator identity digest.');

  const stateReference=normalizeReference(predecessor.stateReference,'predecessorStateEvidence.stateReference');
  if(String(predecessor.transactionBodyHash ?? '').toLowerCase()!==stateReference.transaction.id) throw new Error('Execute predecessor reference is not bound to its observed transaction body hash.');

  const funding=plainAdaOnlyRole(executorFundingUtxo,'executorFundingUtxo',payer);
  const collateral=plainAdaOnlyRole(executorCollateralUtxo,'executorCollateralUtxo',payer);
  if(new Set([referenceKey(stateReference),referenceKey(funding.reference),referenceKey(collateral.reference)]).size!==3) {
    throw new Error('Execute state, external funding and collateral must be three distinct UTxOs.');
  }

  const core=Object.freeze({
    schema:'omegavault.cardano.preprod-real-execute-plan.v1',
    network:'preprod',
    action:'execute',
    predecessorStateEvidenceSha256:predecessor.stateEvidenceSha256,
    predecessorTransactionBodyHash:predecessor.transactionBodyHash,
    predecessorObservedTip:predecessor.observedTip,
    validatorIdentitySha256:predecessor.validatorIdentitySha256,
    stateInput:stateReference,
    feePayerKeyHash:payer,
    executorFundingInput:funding.reference,
    executorFundingAddress:funding.address,
    executorCollateralInput:collateral.reference,
    executorCollateralAddress:collateral.address,
    protectedState:Object.freeze({
      address:predecessor.state.address,
      lovelace:String(predecessor.state.lovelace),
      beaconPolicyId:String(predecessor.state.beaconPolicyId).toLowerCase(),
      beaconAssetNameHex:String(predecessor.state.beaconAssetNameHex).toLowerCase(),
      beaconQuantity:'1',
      predecessorInlineDatumCborHex:String(predecessor.state.inlineDatumCborHex).toLowerCase(),
      ownerPaymentKeyHash:owner,
      rescueKeyHash:rescue,
      contactKeyHashes:Object.freeze(contacts),
      threshold,
      inactivityMs,
      lastHeartbeatMs:predecessor.state.lastHeartbeatMs,
      approvalKeyHashes:Object.freeze(approvals)
    }),
    externalFunding:Object.freeze({
      fundingLovelace:funding.lovelace,
      collateralLovelace:collateral.lovelace,
      protectedStateMayNotPayFees:true,
      feePayerHasNoRescueRedirectionAuthority:true
    }),
    executionRequirements:Object.freeze({
      thresholdAlreadyReached:true,
      inactivityStillRequiredAtExecution:true,
      stateBeaconMustBurnExactlyOnce:true,
      continuingStateForbidden:true,
      exactProtectedValueToImmutableRescue:true,
      rescueDestinationMutationForbidden:true
    }),
    liveActions:Object.freeze({
      networkRequestsPerformed:false,
      walletSigningAuthorized:false,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    nextGate:'bind-current-preprod-tip-and-protocol-parameters-then-build-live-evaluation-execute-candidate',
    authorityBoundary:'This plan binds execution to one threshold-approved active state and an immutable rescue key while externalizing fees/collateral. The fee payer has no authority to redirect protected value. No network request, signing, submission, value movement, recovery proof or support promotion is authorized.'
  });
  return Object.freeze({ ...core,planSha256:hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodRealExecutePlan({ plan,...inputs }){
  if(!plan || typeof plan!=='object' || Array.isArray(plan)) return Object.freeze({ valid:false,errors:Object.freeze(['Real execute plan is required.']),recomputedSha256:null });
  const errors=[];
  let recomputed;
  try { recomputed=createCardanoPreprodRealExecutePlan(inputs); }
  catch(error){ return Object.freeze({ valid:false,errors:Object.freeze([error.message]),recomputedSha256:null }); }
  if(!HEX_32.test(String(plan.planSha256 ?? '')) || hashCardanoEvidence(withoutDigest(plan,'planSha256'))!==plan.planSha256) errors.push('Real execute plan self-digest mismatch.');
  if(plan.planSha256!==recomputed.planSha256) errors.push('Real execute plan does not reproduce from its bound predecessor/funding evidence.');
  return Object.freeze({ valid:errors.length===0,errors:Object.freeze(errors),recomputedSha256:recomputed.planSha256 });
}
