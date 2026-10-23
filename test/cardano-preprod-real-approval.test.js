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
  createCardanoPreprodRealApprovalPlan,
  verifyCardanoPreprodRealApprovalPlan
} from '../src/chains/cardano/preprod-real-approval-plan.js';
import {
  buildCardanoPreprodRealApprovalCandidate,
  verifyCardanoPreprodRealApprovalCandidate
} from '../src/chains/cardano/preprod-real-approval.js';

const protocolSnapshot=JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json',import.meta.url),'utf8'));
protocolSnapshot.source.independentSourceCount=2;
protocolSnapshot.promotion.independentlyConfirmed=true;
const parameters=normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);

const fixtureEvidence=JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json',import.meta.url),'utf8'));
const beaconBlueprint=JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json',import.meta.url),'utf8'));
const vaultBlueprint=JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json',import.meta.url),'utf8'));
const beaconCompiledCode=beaconBlueprint.validators.find(item=>item.title==='omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode=vaultBlueprint.validators.find(item=>item.title==='omegavault.recovery_vault.spend').compiledCode;
const sourceBlueprintSha256=createHash('sha256')
  .update(readFileSync(new URL('../validators/cardano/plutus.json',import.meta.url)))
  .digest('hex');

const owner='11'.repeat(28);
const contactA='22'.repeat(28);
const contactB='33'.repeat(28);
const rescue='66'.repeat(28);

function keyAddress(keyHash){
  return Cardano.EnterpriseAddress.new(
    0,
    Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(keyHash))
  ).to_address().to_bech32();
}

const ownerAddress=keyAddress(owner);
const contactAAddress=keyAddress(contactA);

const identity=createCardanoPreprodAppliedValidatorIdentity({
  seedReference:{ transaction:{ id:fixtureEvidence.parameters.seedTxId },index:fixtureEvidence.parameters.seedOutputIndex },
  assetNameHex:fixtureEvidence.parameters.assetNameHex,
  sourceBlueprintSha256,
  beaconCompiledCode,
  recoveryCompiledCode,
  aikenPolicyId:fixtureEvidence.stateBeacon.policyId,
  aikenRecoveryHash:fixtureEvidence.recoveryVault.scriptHash,
  aikenRecoveryAddress:fixtureEvidence.recoveryVault.preprodAddress
});

const recoveryConfig=Object.freeze({
  ownerPaymentKeyHash:owner,
  rescueKeyHash:rescue,
  contactKeyHashes:[contactA,contactB],
  threshold:2,
  inactivityMs:60000,
  stateLovelace:'10000000'
});

function activeStateEvidence({ approvals=[],lastHeartbeatSlot=100000060 }={}){
  const lastHeartbeatMs=cardanoPreprodSlotToUnixTimeMs(lastHeartbeatSlot);
  const datum=createCardanoVaultDatumData({
    ownerKeyHash:owner,
    rescueKeyHash:rescue,
    contactKeyHashes:[contactA,contactB],
    threshold:2,
    inactivityMs:60000,
    lastHeartbeatMs,
    approvalKeyHashes:approvals
  });
  const core={
    schema:'omegavault.cardano.preprod-active-state-evidence.v1',
    network:'preprod',
    sourceAction:approvals.length?'approve':'heartbeat',
    transactionBodyHash:'ab'.repeat(32),
    sourceArtifactSha256:'bc'.repeat(32),
    validatorIdentitySha256:identity.identitySha256,
    observedTip:{ hash:'cd'.repeat(32),slot:100000090 },
    stateReference:{ transaction:{ id:'ab'.repeat(32) },index:0 },
    state:{
      address:identity.recoveryVault.address,
      lovelace:'10000000',
      beaconPolicyId:identity.stateBeacon.policyId,
      beaconAssetNameHex:identity.assetNameHex,
      beaconQuantity:'1',
      inlineDatumCborHex:Buffer.from(datum.to_bytes()).toString('hex'),
      ownerPaymentKeyHash:owner,
      rescueKeyHash:rescue,
      contactKeyHashes:[contactA,contactB],
      threshold:2,
      inactivityMs:60000,
      lastHeartbeatMs,
      approvalKeyHashes:[...approvals]
    },
    checks:{ inclusionObserved:true,exactActiveStateObserved:true,finalityProven:false },
    liveActions:{
      walletSigningPerformed:true,
      transactionSubmissionPerformed:true,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    },
    authorityBoundary:'fixture'
  };
  return Object.freeze({ ...core,stateEvidenceSha256:hashCardanoEvidence(core) });
}

function plainUtxo(idByte,index,address,lovelace){
  return {
    transaction:{ id:idByte.repeat(32) },
    index,
    address,
    value:{ ada:{ lovelace:String(lovelace) } }
  };
}

function planInput(evidence=activeStateEvidence()){
  return {
    predecessorStateEvidence:evidence,
    expectedPredecessorStateSha256:evidence.stateEvidenceSha256,
    selectedContactKeyHash:contactA,
    contactFundingUtxo:plainUtxo('12',0,contactAAddress,'5000000'),
    contactCollateralUtxo:plainUtxo('34',1,contactAAddress,'4000000')
  };
}

test('real approval plan binds one configured independent contact and that contacts funding/collateral',()=>{
  const input=planInput();
  const plan=createCardanoPreprodRealApprovalPlan(input);
  assert.equal(plan.selectedContactKeyHash,contactA);
  assert.deepEqual(plan.protectedState.predecessorApprovalKeyHashes,[]);
  assert.deepEqual(plan.protectedState.nextApprovalKeyHashes,[contactA]);
  assert.equal(plan.authorityChecks.selectedSignerIsNotOwner,true);
  assert.equal(plan.authorityChecks.selectedContactControlsFunding,true);
  assert.equal(plan.liveActions.walletSigningAuthorized,false);
  assert.equal(plan.liveActions.transactionSubmissionAuthorized,false);
  assert.match(plan.planSha256,/^[0-9a-f]{64}$/);

  const verified=verifyCardanoPreprodRealApprovalPlan({ plan,...input });
  assert.equal(verified.valid,true,verified.errors.join('; '));
});

test('real approval plan rejects owner substitution, unconfigured contacts and duplicates',()=>{
  const evidence=activeStateEvidence();
  assert.throws(
    ()=>createCardanoPreprodRealApprovalPlan({ ...planInput(evidence),selectedContactKeyHash:owner }),
    /Owner cannot substitute/
  );
  assert.throws(
    ()=>createCardanoPreprodRealApprovalPlan({ ...planInput(evidence),selectedContactKeyHash:'44'.repeat(28) }),
    /not a configured trusted contact/
  );

  const duplicate=activeStateEvidence({ approvals:[contactA] });
  assert.throws(
    ()=>createCardanoPreprodRealApprovalPlan(planInput(duplicate)),
    /already approved/
  );
});

test('real approval plan rejects coercive predecessor policy integers after digest recomputation',()=>{
  for(const invalid of [
    { threshold:true },
    { inactivityMs:'6e4' }
  ]){
    const evidence=structuredClone(activeStateEvidence());
    Object.assign(evidence.state,invalid);
    evidence.stateEvidenceSha256=hashCardanoEvidence(
      Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='stateEvidenceSha256'))
    );
    assert.throws(
      ()=>createCardanoPreprodRealApprovalPlan(planInput(evidence)),
      /must be a positive safe integer/
    );
  }
});

test('real approval plan rejects funding controlled by owner instead of selected contact',()=>{
  const input=planInput();
  assert.throws(
    ()=>createCardanoPreprodRealApprovalPlan({
      ...input,
      contactFundingUtxo:plainUtxo('12',0,ownerAddress,'5000000')
    }),
    /not controlled by the selected trusted contact/
  );
});

test('real approval candidate adds exactly one contact approval and preserves protected state',()=>{
  const approvalPlan=createCardanoPreprodRealApprovalPlan(planInput());
  const stableTip={ hash:'56'.repeat(32),slot:100000200 };
  const candidate=buildCardanoPreprodRealApprovalCandidate({
    approvalPlan,
    appliedValidatorIdentity:identity,
    parameters,
    recoveryConfig,
    stableTip,
    evaluationMode:true
  });

  assert.equal(candidate.selectedContactKeyHash,contactA);
  assert.equal(candidate.validity.inactivityEligible,true);
  assert.deepEqual(candidate.stateTransition.predecessorApprovals,[]);
  assert.deepEqual(candidate.stateTransition.nextApprovals,[contactA]);
  assert.equal(candidate.stateTransition.addedApproval,contactA);
  assert.equal(candidate.transaction.requiredSigner,contactA);
  assert.equal(candidate.stateTransition.protectedLovelace,'10000000');
  assert.equal(candidate.stateTransition.beaconQuantity,'1');
  assert.equal(candidate.stateTransition.protectedValueUsedForFees,false);
  assert.equal(candidate.checks.exactlyOneApprovalAdded,true);
  assert.equal(candidate.transaction.keyWitnessCount,0);
  assert.equal(candidate.evaluation.spendBudget.memory,'0');
  assert.equal(candidate.evaluation.spendBudget.steps,'0');
  assert.equal(candidate.checks.fullPhaseOneValidated,false);
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized,false);

  const verified=verifyCardanoPreprodRealApprovalCandidate({
    candidate,
    approvalPlan,
    appliedValidatorIdentity:identity,
    parameters,
    recoveryConfig,
    stableTip,
    evaluationMode:true
  });
  assert.equal(verified.valid,true,verified.errors.join('; '));
});

test('real approval candidate enforces inactivity at the candidate validity lower bound',()=>{
  const approvalPlan=createCardanoPreprodRealApprovalPlan(planInput());
  assert.throws(
    ()=>buildCardanoPreprodRealApprovalCandidate({
      approvalPlan,
      appliedValidatorIdentity:identity,
      parameters,
      recoveryConfig,
      stableTip:{ hash:'56'.repeat(32),slot:100000100 },
      evaluationMode:true
    }),
    /inactivity period has not elapsed/
  );
});

test('real approval rejects coercive recovery-policy integer inputs',()=>{
  const approvalPlan=createCardanoPreprodRealApprovalPlan(planInput());
  for(const invalid of [
    { threshold:true },
    { inactivityMs:true },
    { threshold:'0x2' },
    { inactivityMs:'6e4' }
  ]){
    assert.throws(
      ()=>buildCardanoPreprodRealApprovalCandidate({
        approvalPlan,
        appliedValidatorIdentity:identity,
        parameters,
        recoveryConfig:{ ...recoveryConfig,...invalid },
        stableTip:{ hash:'56'.repeat(32),slot:100000200 },
        evaluationMode:true
      }),
      /must be a positive safe integer/
    );
  }
});

test('real approval candidate rejects immutable recovery-policy drift',()=>{
  const approvalPlan=createCardanoPreprodRealApprovalPlan(planInput());
  assert.throws(
    ()=>buildCardanoPreprodRealApprovalCandidate({
      approvalPlan,
      appliedValidatorIdentity:identity,
      parameters,
      recoveryConfig:{ ...recoveryConfig,threshold:1 },
      stableTip:{ hash:'56'.repeat(32),slot:100000200 },
      evaluationMode:true
    }),
    /differs from the immutable predecessor policy/
  );
});
