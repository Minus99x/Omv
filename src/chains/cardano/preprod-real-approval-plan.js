import { hashCardanoEvidence } from './evidence-binding.js';
import { cardanoPreprodPaymentKeyHashFromAddress } from './preprod-recovery-config.js';
import { cardanoPositiveSafeInteger } from './policy-integer.js';

const HEX_28=/^[0-9a-f]{56}$/i;
const HEX_32=/^[0-9a-f]{64}$/i;

function withoutDigest(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));
}

function normalizeReference(value, label) {
  const id=String(value?.transaction?.id ?? '').toLowerCase();
  const index=Number(value?.index);
  if (!HEX_32.test(id)) throw new TypeError(`${label}.transaction.id must be 32-byte hex.`);
  if (!Number.isSafeInteger(index) || index<0) throw new TypeError(`${label}.index must be a non-negative safe integer.`);
  return Object.freeze({ transaction:Object.freeze({ id }), index });
}

function referenceKey(reference) {
  return `${reference.transaction.id}#${reference.index}`;
}

function keyHash(value, label) {
  const normalized=String(value ?? '').toLowerCase();
  if (!HEX_28.test(normalized)) throw new TypeError(`${label} must be 28-byte hex.`);
  return normalized;
}

function plainAdaOnlyRole(value, label, expectedPaymentKeyHash) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError(`${label} UTxO is required.`);
  const reference=normalizeReference(value, label);
  const address=String(value.address ?? '');
  const paymentKeyHash=cardanoPreprodPaymentKeyHashFromAddress(address, `${label}.address`);
  if (paymentKeyHash!==expectedPaymentKeyHash) throw new Error(`${label} UTxO is not controlled by the selected trusted contact.`);

  const topKeys=Object.keys(value.value ?? {});
  if (topKeys.length!==1 || topKeys[0]!=='ada') throw new Error(`${label} UTxO must be plain ADA-only.`);
  const lovelace=String(value.value?.ada?.lovelace ?? '');
  if (!/^\d+$/.test(lovelace) || BigInt(lovelace)<1n) throw new TypeError(`${label} UTxO lovelace must be a positive integer.`);
  if (value.datum!=null || value.datumHash!=null) throw new Error(`${label} UTxO must not contain datum material.`);
  if (value.script!=null) throw new Error(`${label} UTxO must not contain a reference script.`);
  return Object.freeze({ reference, address, paymentKeyHash, lovelace });
}

function verifiedPredecessor(value, expectedSha256) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError('Predecessor active-state evidence is required.');
  if (!HEX_32.test(String(expectedSha256 ?? ''))) throw new TypeError('expectedPredecessorStateSha256 must be 32-byte hex.');
  if (value.schema!=='omegavault.cardano.preprod-active-state-evidence.v1' ||
      value.network!=='preprod' ||
      !['initialize','heartbeat','approve'].includes(value.sourceAction) ||
      value.checks?.inclusionObserved!==true ||
      value.checks?.exactActiveStateObserved!==true ||
      value.liveActions?.transactionSubmissionPerformed!==true ||
      value.liveActions?.supportClaimAuthorized!==false ||
      value.liveActions?.publicNetworkRecoveryProven!==false) {
    throw new Error('Predecessor evidence is not at the required active-state authority boundary.');
  }
  if (value.stateEvidenceSha256!==String(expectedSha256).toLowerCase()) {
    throw new Error('Predecessor active-state digest does not match the explicitly selected evidence.');
  }
  if (hashCardanoEvidence(withoutDigest(value,'stateEvidenceSha256'))!==value.stateEvidenceSha256) {
    throw new Error('Predecessor active-state evidence self-digest mismatch.');
  }
  return value;
}

export function createCardanoPreprodRealApprovalPlan({
  predecessorStateEvidence,
  expectedPredecessorStateSha256,
  selectedContactKeyHash,
  contactFundingUtxo,
  contactCollateralUtxo
}) {
  const predecessor=verifiedPredecessor(predecessorStateEvidence, expectedPredecessorStateSha256);
  const selectedContact=keyHash(selectedContactKeyHash,'selectedContactKeyHash');
  const owner=keyHash(predecessor.state?.ownerPaymentKeyHash,'predecessorStateEvidence.state.ownerPaymentKeyHash');
  const rescue=keyHash(predecessor.state?.rescueKeyHash,'predecessorStateEvidence.state.rescueKeyHash');
  const contacts=(predecessor.state?.contactKeyHashes ?? []).map((entry,index)=>keyHash(entry,`predecessorStateEvidence.state.contactKeyHashes[${index}]`));
  const approvals=(predecessor.state?.approvalKeyHashes ?? []).map((entry,index)=>keyHash(entry,`predecessorStateEvidence.state.approvalKeyHashes[${index}]`));

  if (!contacts.length || new Set(contacts).size!==contacts.length) throw new Error('Predecessor trusted-contact set is missing or invalid.');
  if (new Set(approvals).size!==approvals.length || approvals.some(entry=>!contacts.includes(entry))) throw new Error('Predecessor approvals are invalid.');
  if (selectedContact===owner) throw new Error('Owner cannot substitute for a trusted-contact approval.');
  if (selectedContact===rescue) throw new Error('Immutable rescue destination cannot act as the selected trusted contact.');
  if (!contacts.includes(selectedContact)) throw new Error('Selected approval signer is not a configured trusted contact.');
  if (approvals.includes(selectedContact)) throw new Error('Selected trusted contact has already approved this recovery state.');

  const stateReference=normalizeReference(predecessor.stateReference,'predecessorStateEvidence.stateReference');
  if (String(predecessor.transactionBodyHash ?? '').toLowerCase()!==stateReference.transaction.id) {
    throw new Error('Predecessor active-state reference is not bound to the observed transaction body hash.');
  }
  if (!HEX_32.test(String(predecessor.validatorIdentitySha256 ?? ''))) throw new Error('Predecessor active-state evidence is missing validator identity digest.');
  if (!Number.isSafeInteger(predecessor.state?.lastHeartbeatMs) || predecessor.state.lastHeartbeatMs<0) {
    throw new Error('Predecessor active-state evidence is missing lastHeartbeatMs.');
  }
  const threshold=cardanoPositiveSafeInteger(predecessor.state?.threshold,'Predecessor threshold');
  if (threshold>contacts.length) throw new Error('Predecessor threshold is invalid.');
  const inactivityMs=cardanoPositiveSafeInteger(predecessor.state?.inactivityMs,'Predecessor inactivity interval');

  const funding=plainAdaOnlyRole(contactFundingUtxo,'contactFundingUtxo',selectedContact);
  const collateral=plainAdaOnlyRole(contactCollateralUtxo,'contactCollateralUtxo',selectedContact);
  if (new Set([referenceKey(stateReference),referenceKey(funding.reference),referenceKey(collateral.reference)]).size!==3) {
    throw new Error('Approval state, contact funding and collateral must be three distinct UTxOs.');
  }

  const nextApprovals=Object.freeze([...approvals,selectedContact]);
  const core=Object.freeze({
    schema:'omegavault.cardano.preprod-real-approval-plan.v1',
    network:'preprod',
    action:'approve',
    predecessorStateEvidenceSha256:predecessor.stateEvidenceSha256,
    predecessorTransactionBodyHash:predecessor.transactionBodyHash,
    predecessorObservedTip:predecessor.observedTip,
    validatorIdentitySha256:predecessor.validatorIdentitySha256,
    stateInput:stateReference,
    selectedContactKeyHash:selectedContact,
    contactFundingInput:funding.reference,
    contactFundingAddress:funding.address,
    contactCollateralInput:collateral.reference,
    contactCollateralAddress:collateral.address,
    protectedState:Object.freeze({
      address:predecessor.state.address,
      lovelace:String(predecessor.state.lovelace),
      beaconPolicyId:String(predecessor.state.beaconPolicyId).toLowerCase(),
      beaconAssetNameHex:String(predecessor.state.beaconAssetNameHex).toLowerCase(),
      beaconQuantity:String(predecessor.state.beaconQuantity),
      predecessorInlineDatumCborHex:String(predecessor.state.inlineDatumCborHex).toLowerCase(),
      ownerPaymentKeyHash:owner,
      rescueKeyHash:rescue,
      contactKeyHashes:Object.freeze(contacts),
      threshold,
      inactivityMs,
      lastHeartbeatMs:predecessor.state.lastHeartbeatMs,
      predecessorApprovalKeyHashes:Object.freeze(approvals),
      nextApprovalKeyHashes:nextApprovals
    }),
    externalFunding:Object.freeze({
      fundingLovelace:funding.lovelace,
      collateralLovelace:collateral.lovelace,
      feeMustComeFromSelectedContactFunding:true,
      protectedStateMayNotPayFees:true
    }),
    authorityChecks:Object.freeze({
      selectedSignerIsConfiguredContact:true,
      selectedSignerIsNotOwner:true,
      selectedSignerIsNotRescue:true,
      duplicateApprovalRejected:true,
      selectedContactControlsFunding:true,
      selectedContactControlsCollateral:true,
      independentContactWalletRequiredForPublicMultipartyProof:true
    }),
    liveActions:Object.freeze({
      networkRequestsPerformed:false,
      walletSigningAuthorized:false,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    nextGate:'bind-current-preprod-tip-and-protocol-parameters-then-build-live-evaluation-approval-candidate',
    authorityBoundary:'This plan binds one configured non-owner trusted contact to exactly one new approval transition and to that contact\'s own funding/collateral UTxOs. It performs no network request, creates no signature, authorizes no signing or submission, moves no value and does not prove public-network recovery.'
  });
  return Object.freeze({ ...core, planSha256:hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodRealApprovalPlan({ plan, ...inputs }) {
  if (!plan || typeof plan!=='object' || Array.isArray(plan)) {
    return Object.freeze({ valid:false, errors:Object.freeze(['Real approval plan is required.']), recomputedSha256:null });
  }
  const errors=[];
  let recomputed;
  try {
    recomputed=createCardanoPreprodRealApprovalPlan(inputs);
  } catch (error) {
    return Object.freeze({ valid:false, errors:Object.freeze([error.message]), recomputedSha256:null });
  }
  if (!HEX_32.test(String(plan.planSha256 ?? '')) ||
      hashCardanoEvidence(withoutDigest(plan,'planSha256'))!==plan.planSha256) {
    errors.push('Real approval plan self-digest mismatch.');
  }
  if (plan.planSha256!==recomputed.planSha256) errors.push('Real approval plan does not reproduce from its bound predecessor/contact evidence.');
  return Object.freeze({ valid:errors.length===0, errors:Object.freeze(errors), recomputedSha256:recomputed.planSha256 });
}
