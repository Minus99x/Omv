import { hashCardanoEvidence } from './evidence-binding.js';
import { cardanoPreprodPaymentKeyHashFromAddress } from './preprod-recovery-config.js';

const HEX_28 = /^[0-9a-f]{56}$/i;
const HEX_32 = /^[0-9a-f]{64}$/i;

function withoutDigest(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function normalizeReference(value, label) {
  const id = String(value?.transaction?.id ?? '').toLowerCase();
  const index = Number(value?.index);
  if (!HEX_32.test(id)) throw new TypeError(`${label}.transaction.id must be 32-byte hex.`);
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError(`${label}.index must be a non-negative safe integer.`);
  return Object.freeze({ transaction:Object.freeze({ id }), index });
}

function referenceKey(value) {
  return `${value.transaction.id}#${value.index}`;
}

function plainAdaOnlyRole(value, label, expectedOwnerKeyHash) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} UTxO is required.`);
  const reference = normalizeReference(value, label);
  const address = String(value.address ?? '');
  const paymentKeyHash = cardanoPreprodPaymentKeyHashFromAddress(address, `${label}.address`);
  if (paymentKeyHash !== expectedOwnerKeyHash) throw new Error(`${label} UTxO is not controlled by the bound owner payment key.`);

  const topKeys = Object.keys(value.value ?? {});
  if (topKeys.length !== 1 || topKeys[0] !== 'ada') throw new Error(`${label} UTxO must be plain ADA-only.`);
  const lovelace = String(value.value?.ada?.lovelace ?? '');
  if (!/^\d+$/.test(lovelace) || BigInt(lovelace) < 1n) throw new TypeError(`${label} UTxO lovelace must be a positive integer.`);
  if (value.datum != null || value.datumHash != null) throw new Error(`${label} UTxO must not contain datum material.`);
  if (value.script != null) throw new Error(`${label} UTxO must not contain a reference script.`);

  return Object.freeze({
    reference,
    address,
    paymentKeyHash,
    lovelace
  });
}

function verifiedObservationEnvelope(evidence, expectedSha256) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new TypeError('Initialize state-observation evidence is required.');
  }
  if (!HEX_32.test(String(expectedSha256 ?? ''))) {
    throw new TypeError('expectedStateObservationSha256 must be 32-byte hex.');
  }
  if (evidence.schema !== 'omegavault.cardano.preprod-initialize-state-observation-evidence.v1' ||
      evidence.network !== 'preprod' ||
      evidence.action !== 'initialize' ||
      evidence.checks?.inclusionObserved !== true ||
      evidence.checks?.exactStateOutputReferenceObserved !== true ||
      evidence.checks?.exactRecoveryValidatorAddressObserved !== true ||
      evidence.checks?.exactProtectedLovelaceObserved !== true ||
      evidence.checks?.exactSingleBeaconObserved !== true ||
      evidence.checks?.exactConfiguredInlineDatumObserved !== true ||
      evidence.liveActions?.transactionSubmissionPerformed !== true ||
      evidence.liveActions?.publicNetworkRecoveryProven !== false ||
      evidence.liveActions?.supportClaimAuthorized !== false) {
    throw new Error('Initialize state-observation evidence is not at the expected post-inclusion authority boundary.');
  }
  if (evidence.observationSha256 !== expectedSha256.toLowerCase()) {
    throw new Error('Initialize state-observation digest does not match the explicitly selected predecessor evidence.');
  }
  if (hashCardanoEvidence(withoutDigest(evidence, 'observationSha256')) !== evidence.observationSha256) {
    throw new Error('Initialize state-observation evidence self-digest mismatch.');
  }
  return evidence;
}

export function createCardanoPreprodRealHeartbeatPlan({
  stateObservationEvidence,
  expectedStateObservationSha256,
  ownerFundingUtxo,
  collateralUtxo,
  ownerPaymentKeyHash
}) {
  const observation = verifiedObservationEnvelope(stateObservationEvidence, expectedStateObservationSha256);
  const owner = String(ownerPaymentKeyHash ?? '').toLowerCase();
  if (!HEX_28.test(owner)) throw new TypeError('ownerPaymentKeyHash must be 28-byte hex.');

  const funding = plainAdaOnlyRole(ownerFundingUtxo, 'ownerFundingUtxo', owner);
  const collateral = plainAdaOnlyRole(collateralUtxo, 'collateralUtxo', owner);
  const stateReference = normalizeReference(observation.stateReference, 'stateObservationEvidence.stateReference');

  const keys = new Set([
    referenceKey(stateReference),
    referenceKey(funding.reference),
    referenceKey(collateral.reference)
  ]);
  if (keys.size !== 3) throw new Error('Heartbeat state, funding and collateral UTxOs must be three distinct output references.');

  if (String(observation.stateObservation?.inlineDatumCborHex ?? '').length < 2) {
    throw new Error('Heartbeat predecessor state observation is missing its inline datum.');
  }
  if (!HEX_32.test(String(observation.transactionBodyHash ?? '')) ||
      observation.transactionBodyHash !== stateReference.transaction.id) {
    throw new Error('Heartbeat predecessor state reference is not bound to the observed initialize transaction body hash.');
  }

  const core = Object.freeze({
    schema:'omegavault.cardano.preprod-real-heartbeat-plan.v1',
    network:'preprod',
    action:'heartbeat',
    predecessorStateObservationSha256:observation.observationSha256,
    predecessorTransactionBodyHash:observation.transactionBodyHash,
    predecessorObservedTip:observation.observedTip,
    validatorIdentitySha256:observation.validatorIdentitySha256,
    stateInput:stateReference,
    ownerFundingInput:funding.reference,
    ownerFundingAddress:funding.address,
    collateralInput:collateral.reference,
    collateralAddress:collateral.address,
    ownerPaymentKeyHash:owner,
    protectedState:Object.freeze({
      address:observation.stateObservation.address,
      lovelace:observation.stateObservation.lovelace,
      beaconPolicyId:observation.stateObservation.beaconPolicyId,
      beaconAssetNameHex:observation.stateObservation.beaconAssetNameHex,
      beaconQuantity:observation.stateObservation.beaconQuantity,
      predecessorInlineDatumCborHex:observation.stateObservation.inlineDatumCborHex,
      predecessorLastHeartbeatMs:observation.stateObservation.lastHeartbeatMs,
      predecessorApprovalKeyHashes:observation.stateObservation.approvalKeyHashes
    }),
    externalFunding:Object.freeze({
      fundingLovelace:funding.lovelace,
      collateralLovelace:collateral.lovelace,
      feeMustComeFromExternalFunding:true,
      protectedStateMayNotPayFees:true
    }),
    prerequisites:Object.freeze({
      predecessorInclusionObserved:true,
      predecessorFinalityRequiredBeforeLifecyclePromotion:true,
      currentStableTipRequired:true,
      currentProtocolParametersRequired:true,
      liveOgmiosEvaluationRequired:true,
      ownerWalletWitnessRequiredLater:true
    }),
    liveActions:Object.freeze({
      networkRequestsPerformed:false,
      walletSigningAuthorized:false,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    }),
    nextGate:'bind-current-preprod-state-and-protocol-parameters-then-build-live-evaluation-heartbeat-candidate',
    authorityBoundary:'This plan binds heartbeat construction to one exact observed initialize state UTxO plus distinct owner funding/collateral UTxOs. It performs no network request, does not prove predecessor finality, creates no signature, authorizes no submission, moves no value, and does not prove recovery or support.'
  });
  return Object.freeze({ ...core, planSha256:hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodRealHeartbeatPlan({ plan, ...inputs }) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return Object.freeze({ valid:false, errors:Object.freeze(['Real heartbeat plan is required.']), recomputedSha256:null });
  }
  const errors=[];
  let recomputed;
  try {
    recomputed=createCardanoPreprodRealHeartbeatPlan(inputs);
  } catch (error) {
    return Object.freeze({ valid:false, errors:Object.freeze([error.message]), recomputedSha256:null });
  }
  if (!HEX_32.test(String(plan.planSha256 ?? '')) ||
      hashCardanoEvidence(withoutDigest(plan, 'planSha256')) !== plan.planSha256) {
    errors.push('Real heartbeat plan self-digest mismatch.');
  }
  if (plan.planSha256 !== recomputed.planSha256) {
    errors.push('Real heartbeat plan does not reproduce from its bound predecessor/funding evidence.');
  }
  return Object.freeze({ valid:errors.length===0, errors:Object.freeze(errors), recomputedSha256:recomputed.planSha256 });
}
