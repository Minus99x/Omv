import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
import { createCardanoVaultDatumData, cardanoPreprodSlotToUnixTimeMs } from '../src/chains/cardano/transaction-body.js';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import {
  buildCardanoPreprodRealHeartbeatCandidate,
  verifyCardanoPreprodRealHeartbeatCandidate
} from '../src/chains/cardano/preprod-real-heartbeat.js';

const protocolSnapshot=JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
protocolSnapshot.source.independentSourceCount=2;
protocolSnapshot.promotion.independentlyConfirmed=true;
const parameters=normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);

const fixtureEvidence=JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json', import.meta.url), 'utf8'));
const beaconBlueprint=JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vaultBlueprint=JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode=beaconBlueprint.validators.find(item=>item.title==='omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode=vaultBlueprint.validators.find(item=>item.title==='omegavault.recovery_vault.spend').compiledCode;
const sourceBlueprintSha256=createHash('sha256')
  .update(readFileSync(new URL('../validators/cardano/plutus.json', import.meta.url)))
  .digest('hex');

const ownerKeyHash='11'.repeat(28);
const rescueKeyHash='66'.repeat(28);
const contactKeyHashes=['22'.repeat(28),'33'.repeat(28)];
const ownerAddress=Cardano.EnterpriseAddress.new(
  0,
  Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(ownerKeyHash))
).to_address().to_bech32();

const recoveryConfig=Object.freeze({
  rescueKeyHash,
  contactKeyHashes,
  threshold:2,
  inactivityMs:60000,
  stateLovelace:'10000000'
});

const identity=createCardanoPreprodAppliedValidatorIdentity({
  seedReference:{
    transaction:{ id:fixtureEvidence.parameters.seedTxId },
    index:fixtureEvidence.parameters.seedOutputIndex
  },
  assetNameHex:fixtureEvidence.parameters.assetNameHex,
  sourceBlueprintSha256,
  beaconCompiledCode,
  recoveryCompiledCode,
  aikenPolicyId:fixtureEvidence.stateBeacon.policyId,
  aikenRecoveryHash:fixtureEvidence.recoveryVault.scriptHash,
  aikenRecoveryAddress:fixtureEvidence.recoveryVault.preprodAddress
});

function heartbeatPlan() {
  const predecessorLastHeartbeatMs=cardanoPreprodSlotToUnixTimeMs(100000060);
  const predecessorDatum=createCardanoVaultDatumData({
    ownerKeyHash,
    rescueKeyHash,
    contactKeyHashes,
    threshold:2,
    inactivityMs:60000,
    lastHeartbeatMs:predecessorLastHeartbeatMs,
    approvalKeyHashes:[]
  });
  const core={
    schema:'omegavault.cardano.preprod-real-heartbeat-plan.v1',
    network:'preprod',
    action:'heartbeat',
    predecessorStateObservationSha256:'aa'.repeat(32),
    predecessorTransactionBodyHash:'bb'.repeat(32),
    predecessorObservedTip:{ hash:'cc'.repeat(32), slot:100000100 },
    validatorIdentitySha256:identity.identitySha256,
    stateInput:{ transaction:{ id:'bb'.repeat(32) }, index:0 },
    ownerFundingInput:{ transaction:{ id:'dd'.repeat(32) }, index:0 },
    ownerFundingAddress:ownerAddress,
    collateralInput:{ transaction:{ id:'ee'.repeat(32) }, index:0 },
    collateralAddress:ownerAddress,
    ownerPaymentKeyHash:ownerKeyHash,
    protectedState:{
      address:identity.recoveryVault.address,
      lovelace:'10000000',
      beaconPolicyId:identity.stateBeacon.policyId,
      beaconAssetNameHex:identity.assetNameHex,
      beaconQuantity:'1',
      predecessorInlineDatumCborHex:Buffer.from(predecessorDatum.to_bytes()).toString('hex'),
      predecessorLastHeartbeatMs,
      predecessorApprovalKeyHashes:[]
    },
    externalFunding:{
      fundingLovelace:'5000000',
      collateralLovelace:'4000000',
      feeMustComeFromExternalFunding:true,
      protectedStateMayNotPayFees:true
    },
    prerequisites:{
      predecessorInclusionObserved:true,
      predecessorFinalityRequiredBeforeLifecyclePromotion:true,
      currentStableTipRequired:true,
      currentProtocolParametersRequired:true,
      liveOgmiosEvaluationRequired:true,
      ownerWalletWitnessRequiredLater:true
    },
    liveActions:{
      networkRequestsPerformed:false,
      walletSigningAuthorized:false,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    },
    nextGate:'bind-current-preprod-state-and-protocol-parameters-then-build-live-evaluation-heartbeat-candidate',
    authorityBoundary:'fixture'
  };
  return Object.freeze({ ...core, planSha256:hashCardanoEvidence(core) });
}

test('real heartbeat evaluation candidate preserves protected state and stays unsigned', () => {
  const heartbeatPlanInput=heartbeatPlan();
  const stableTip={ hash:'12'.repeat(32), slot:100000200 };
  const candidate=buildCardanoPreprodRealHeartbeatCandidate({
    heartbeatPlan:heartbeatPlanInput,
    appliedValidatorIdentity:identity,
    parameters,
    recoveryConfig,
    stableTip,
    evaluationMode:true
  });

  assert.equal(candidate.action,'heartbeat');
  assert.equal(candidate.stateTransition.protectedLovelace,'10000000');
  assert.equal(candidate.stateTransition.beaconQuantity,'1');
  assert.deepEqual(candidate.stateTransition.nextApprovals,[]);
  assert.equal(candidate.stateTransition.protectedValueUsedForFees,false);
  assert.equal(candidate.checks.protectedLovelacePreserved,true);
  assert.equal(candidate.checks.heartbeatAdvanced,true);
  assert.equal(candidate.checks.feePaidOnlyFromExternalOwnerFunding,true);
  assert.equal(candidate.transaction.keyWitnessCount,0);
  assert.equal(candidate.evaluation.spendBudget.memory,'0');
  assert.equal(candidate.evaluation.spendBudget.steps,'0');
  assert.equal(candidate.evaluation.requiresLiveEvaluation,true);
  assert.equal(candidate.liveActions.walletSigningAuthorized,false);
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized,false);
  assert.equal(candidate.checks.fullPhaseOneValidated,false);
  assert.match(candidate.transaction.spendRedeemerPointer,/^spend:\d+$/);
  assert.match(candidate.candidateSha256,/^[0-9a-f]{64}$/);

  const verified=verifyCardanoPreprodRealHeartbeatCandidate({
    candidate,
    heartbeatPlan:heartbeatPlanInput,
    appliedValidatorIdentity:identity,
    parameters,
    recoveryConfig,
    stableTip,
    evaluationMode:true
  });
  assert.equal(verified.valid,true,verified.errors.join('; '));
});

test('real heartbeat live-budget candidate binds evaluated spend units without enabling signing', () => {
  const candidate=buildCardanoPreprodRealHeartbeatCandidate({
    heartbeatPlan:heartbeatPlan(),
    appliedValidatorIdentity:identity,
    parameters,
    recoveryConfig,
    stableTip:{ hash:'12'.repeat(32), slot:100000200 },
    evaluationMode:false,
    spendBudget:{ memory:'494618', steps:'158755371' }
  });
  assert.equal(candidate.evaluation.mode,'live-budget-applied-unsigned-candidate');
  assert.equal(candidate.evaluation.spendBudget.memory,'494618');
  assert.equal(candidate.evaluation.spendBudget.steps,'158755371');
  assert.equal(candidate.evaluation.requiresLiveEvaluation,false);
  assert.equal(candidate.liveActions.walletSigningAuthorized,false);
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized,false);
});

test('real heartbeat candidate rejects a recovery config that cannot reproduce predecessor datum', () => {
  assert.throws(
    ()=>buildCardanoPreprodRealHeartbeatCandidate({
      heartbeatPlan:heartbeatPlan(),
      appliedValidatorIdentity:identity,
      parameters,
      recoveryConfig:{ ...recoveryConfig, inactivityMs:120000 },
      stableTip:{ hash:'12'.repeat(32), slot:100000200 },
      evaluationMode:true
    }),
    /does not reproduce the observed heartbeat predecessor datum/
  );
});

test('real heartbeat candidate rejects a tip older than the observed predecessor state', () => {
  assert.throws(
    ()=>buildCardanoPreprodRealHeartbeatCandidate({
      heartbeatPlan:heartbeatPlan(),
      appliedValidatorIdentity:identity,
      parameters,
      recoveryConfig,
      stableTip:{ hash:'12'.repeat(32), slot:100000099 },
      evaluationMode:true
    }),
    /predates the observed predecessor state/
  );
});

test('real heartbeat evaluation candidate rejects nonzero budget injection', () => {
  assert.throws(
    ()=>buildCardanoPreprodRealHeartbeatCandidate({
      heartbeatPlan:heartbeatPlan(),
      appliedValidatorIdentity:identity,
      parameters,
      recoveryConfig,
      stableTip:{ hash:'12'.repeat(32), slot:100000200 },
      evaluationMode:true,
      spendBudget:{ memory:'1', steps:'1' }
    }),
    /must keep the spend redeemer budget at zero/
  );
});
