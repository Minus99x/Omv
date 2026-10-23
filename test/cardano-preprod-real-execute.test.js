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
  createCardanoPreprodRealExecutePlan,
  verifyCardanoPreprodRealExecutePlan
} from '../src/chains/cardano/preprod-real-execute-plan.js';
import {
  buildCardanoPreprodRealExecuteCandidate,
  verifyCardanoPreprodRealExecuteCandidate
} from '../src/chains/cardano/preprod-real-execute.js';

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
const feePayer='44'.repeat(28);

function keyAddress(keyHash){
  return Cardano.EnterpriseAddress.new(
    0,
    Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(keyHash))
  ).to_address().to_bech32();
}

const feePayerAddress=keyAddress(feePayer);
const rescueAddress=keyAddress(rescue);

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

function approvedStateEvidence({ approvals=[contactA,contactB],lastHeartbeatSlot=100000060 }={}){
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
    sourceAction:'approve',
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

function planInput(evidence=approvedStateEvidence()){
  return {
    predecessorStateEvidence:evidence,
    expectedPredecessorStateSha256:evidence.stateEvidenceSha256,
    feePayerKeyHash:feePayer,
    executorFundingUtxo:plainUtxo('12',0,feePayerAddress,'5000000'),
    executorCollateralUtxo:plainUtxo('34',1,feePayerAddress,'4000000')
  };
}

test('real execute plan binds threshold-approved state and externalizes fees',()=>{
  const input=planInput();
  const plan=createCardanoPreprodRealExecutePlan(input);
  assert.equal(plan.executionRequirements.thresholdAlreadyReached,true);
  assert.equal(plan.executionRequirements.stateBeaconMustBurnExactlyOnce,true);
  assert.equal(plan.executionRequirements.continuingStateForbidden,true);
  assert.equal(plan.executionRequirements.exactProtectedValueToImmutableRescue,true);
  assert.equal(plan.externalFunding.protectedStateMayNotPayFees,true);
  assert.equal(plan.liveActions.walletSigningAuthorized,false);
  assert.equal(plan.liveActions.transactionSubmissionAuthorized,false);
  assert.match(plan.planSha256,/^[0-9a-f]{64}$/);

  const verified=verifyCardanoPreprodRealExecutePlan({ plan,...input });
  assert.equal(verified.valid,true,verified.errors.join('; '));
});

test('real execute plan rejects insufficient approval threshold',()=>{
  const evidence=approvedStateEvidence({ approvals:[contactA] });
  assert.throws(
    ()=>createCardanoPreprodRealExecutePlan(planInput(evidence)),
    /has not reached the configured approval threshold/
  );
});

test('real execute plan rejects coercive predecessor policy integers after digest recomputation',()=>{
  for(const invalid of [
    { threshold:true },
    { inactivityMs:'6e4' }
  ]){
    const evidence=structuredClone(approvedStateEvidence());
    Object.assign(evidence.state,invalid);
    evidence.stateEvidenceSha256=hashCardanoEvidence(
      Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='stateEvidenceSha256'))
    );
    assert.throws(
      ()=>createCardanoPreprodRealExecutePlan(planInput(evidence)),
      /must be a positive safe integer/
    );
  }
});

test('real execute plan rejects non-fee-payer funding control',()=>{
  const input=planInput();
  assert.throws(
    ()=>createCardanoPreprodRealExecutePlan({
      ...input,
      executorFundingUtxo:plainUtxo('12',0,keyAddress(owner),'5000000')
    }),
    /not controlled by the configured execution fee payer/
  );
});

test('real execute candidate burns beacon, creates no continuing state and pays exact protected ADA to immutable rescue',()=>{
  const executePlan=createCardanoPreprodRealExecutePlan(planInput());
  const stableTip={ hash:'56'.repeat(32),slot:100000200 };
  const candidate=buildCardanoPreprodRealExecuteCandidate({
    executePlan,
    appliedValidatorIdentity:identity,
    parameters,
    recoveryConfig,
    stableTip,
    evaluationMode:true
  });

  assert.equal(candidate.recovery.immutableRescueAddress,rescueAddress);
  assert.equal(candidate.recovery.protectedLovelace,'10000000');
  assert.equal(candidate.recovery.stateBeaconBurnQuantity,'-1');
  assert.equal(candidate.recovery.continuingStateOutputCount,0);
  assert.equal(candidate.recovery.exactProtectedValueDirectedToRescue,true);
  assert.equal(candidate.recovery.protectedValueUsedForFees,false);
  assert.equal(candidate.checks.thresholdSatisfied,true);
  assert.equal(candidate.checks.inactivitySatisfied,true);
  assert.equal(candidate.checks.immutableRescueDestinationPreserved,true);
  assert.equal(candidate.checks.stateBeaconBurnedExactlyOnce,true);
  assert.equal(candidate.transaction.keyWitnessCount,0);
  assert.equal(candidate.evaluation.spendBudget.memory,'0');
  assert.equal(candidate.evaluation.mintBudget.memory,'0');
  assert.deepEqual(candidate.evaluation.expectedValidators,[candidate.transaction.mintRedeemerPointer,candidate.transaction.spendRedeemerPointer].sort());
  assert.equal(candidate.checks.fullPhaseOneValidated,false);
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized,false);

  const verified=verifyCardanoPreprodRealExecuteCandidate({
    candidate,
    executePlan,
    appliedValidatorIdentity:identity,
    parameters,
    recoveryConfig,
    stableTip,
    evaluationMode:true
  });
  assert.equal(verified.valid,true,verified.errors.join('; '));
});

test('real execute candidate remains inactivity-gated',()=>{
  const executePlan=createCardanoPreprodRealExecutePlan(planInput());
  assert.throws(
    ()=>buildCardanoPreprodRealExecuteCandidate({
      executePlan,
      appliedValidatorIdentity:identity,
      parameters,
      recoveryConfig,
      stableTip:{ hash:'56'.repeat(32),slot:100000100 },
      evaluationMode:true
    }),
    /inactivity period has not elapsed/
  );
});

test('real execute rejects coercive recovery-policy integer inputs',()=>{
  const executePlan=createCardanoPreprodRealExecutePlan(planInput());
  for(const invalid of [
    { threshold:true },
    { inactivityMs:true },
    { threshold:'0x2' },
    { inactivityMs:'6e4' }
  ]){
    assert.throws(
      ()=>buildCardanoPreprodRealExecuteCandidate({
        executePlan,
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

test('real execute candidate rejects rescue-policy mutation',()=>{
  const executePlan=createCardanoPreprodRealExecutePlan(planInput());
  assert.throws(
    ()=>buildCardanoPreprodRealExecuteCandidate({
      executePlan,
      appliedValidatorIdentity:identity,
      parameters,
      recoveryConfig:{ ...recoveryConfig,rescueKeyHash:'77'.repeat(28) },
      stableTip:{ hash:'56'.repeat(32),slot:100000200 },
      evaluationMode:true
    }),
    /differs from the immutable execute predecessor policy/
  );
});

test('real execute evaluation candidate rejects nonzero budget injection',()=>{
  const executePlan=createCardanoPreprodRealExecutePlan(planInput());
  assert.throws(
    ()=>buildCardanoPreprodRealExecuteCandidate({
      executePlan,
      appliedValidatorIdentity:identity,
      parameters,
      recoveryConfig,
      stableTip:{ hash:'56'.repeat(32),slot:100000200 },
      evaluationMode:true,
      spendBudget:{ memory:'1',steps:'1' },
      mintBudget:{ memory:'1',steps:'1' }
    }),
    /must keep spend and mint redeemer budgets at zero/
  );
});
