import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import {
  createCardanoRecoveryDatum,
  validateCardanoExecuteTransition
} from '../src/chains/cardano/recovery-validator.js';
import {
  createCardanoPreprodRealApprovalPlan
} from '../src/chains/cardano/preprod-real-approval-plan.js';

const owner='11'.repeat(28);
const contactA='22'.repeat(28);
const contactB='33'.repeat(28);
const rescue='66'.repeat(28);
const policy='44'.repeat(28);
const beacon=`${policy}.4f56`;
const rescueAddress='addr_test1_immutable_rescue_fixture';

function keyAddress(keyHash){
  return Cardano.EnterpriseAddress.new(
    0,
    Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(keyHash))
  ).to_address().to_bech32();
}

function activeEvidence(approvals=[]){
  const core={
    schema:'omegavault.cardano.preprod-active-state-evidence.v1',
    network:'preprod',
    sourceAction:approvals.length?'approve':'heartbeat',
    transactionBodyHash:'ab'.repeat(32),
    sourceArtifactSha256:'bc'.repeat(32),
    validatorIdentitySha256:'cd'.repeat(32),
    observedTip:{ hash:'de'.repeat(32),slot:100000000 },
    stateReference:{ transaction:{ id:'ab'.repeat(32) },index:0 },
    state:{
      address:'addr_test1wfixture',
      lovelace:'10000000',
      beaconPolicyId:policy,
      beaconAssetNameHex:'4f56',
      beaconQuantity:'1',
      inlineDatumCborHex:'d87980',
      ownerPaymentKeyHash:owner,
      rescueKeyHash:rescue,
      contactKeyHashes:[contactA,contactB],
      threshold:2,
      inactivityMs:60000,
      lastHeartbeatMs:100000,
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

function funding(idByte,index,keyHash){
  return {
    transaction:{ id:idByte.repeat(32) },
    index,
    address:keyAddress(keyHash),
    value:{ ada:{ lovelace:'5000000' } }
  };
}

function approvalPlanArgs(evidence=activeEvidence(),selectedContactKeyHash=contactA){
  return {
    predecessorStateEvidence:evidence,
    expectedPredecessorStateSha256:evidence.stateEvidenceSha256,
    selectedContactKeyHash,
    contactFundingUtxo:funding('12',0,selectedContactKeyHash),
    contactCollateralUtxo:funding('34',1,selectedContactKeyHash)
  };
}

test('adversarial lifecycle: stale predecessor evidence cannot be substituted',()=>{
  const evidence=activeEvidence();
  assert.throws(
    ()=>createCardanoPreprodRealApprovalPlan({
      ...approvalPlanArgs(evidence),
      expectedPredecessorStateSha256:'ff'.repeat(32)
    }),
    /does not match the explicitly selected evidence/
  );
});

test('adversarial lifecycle: duplicate and unconfigured approvals fail closed',()=>{
  const duplicate=activeEvidence([contactA]);
  assert.throws(
    ()=>createCardanoPreprodRealApprovalPlan(approvalPlanArgs(duplicate,contactA)),
    /already approved/
  );

  const unconfigured='77'.repeat(28);
  const evidence=activeEvidence();
  assert.throws(
    ()=>createCardanoPreprodRealApprovalPlan(approvalPlanArgs(evidence,unconfigured)),
    /not a configured trusted contact/
  );
});

function approvedDatum(){
  return createCardanoRecoveryDatum({
    ownerKeyHash:owner,
    rescueAddress,
    contactKeyHashes:[contactA,contactB],
    threshold:2,
    inactivityMs:60000,
    lastHeartbeatMs:100000,
    approvals:[contactA,contactB],
    stateBeaconAsset:beacon
  });
}

const protectedInput={
  lovelace:'10000000',
  [beacon]:'1',
  [`${'55'.repeat(28)}.aa`]:'12'
};
const rescuedValue={
  lovelace:'10000000',
  [`${'55'.repeat(28)}.aa`]:'12'
};

test('adversarial lifecycle: premature execute is rejected even with threshold approvals',()=>{
  assert.throws(
    ()=>validateCardanoExecuteTransition({
      datum:approvedDatum(),
      validityLowerBoundMs:159999,
      inputValue:protectedInput,
      outputsToRescue:[{ address:rescueAddress,value:rescuedValue }],
      continuingOutputs:[],
      mintedValue:{ [beacon]:'-1' }
    }),
    /inactivity period has not elapsed/
  );
});

test('adversarial lifecycle: rescue destination cannot be redirected',()=>{
  assert.throws(
    ()=>validateCardanoExecuteTransition({
      datum:approvedDatum(),
      validityLowerBoundMs:160000,
      inputValue:protectedInput,
      outputsToRescue:[{ address:'addr_test1_wrong_destination',value:rescuedValue }],
      continuingOutputs:[],
      mintedValue:{ [beacon]:'-1' }
    }),
    /immutable rescue address/
  );
});

test('adversarial lifecycle: execute cannot recreate continuing active state or retain beacon',()=>{
  assert.throws(
    ()=>validateCardanoExecuteTransition({
      datum:approvedDatum(),
      validityLowerBoundMs:160000,
      inputValue:protectedInput,
      outputsToRescue:[{ address:rescueAddress,value:rescuedValue }],
      continuingOutputs:[{ address:'addr_test1wfixture',value:protectedInput }],
      mintedValue:{ [beacon]:'-1' }
    }),
    /must not recreate the active vault-state UTXO/
  );

  assert.throws(
    ()=>validateCardanoExecuteTransition({
      datum:approvedDatum(),
      validityLowerBoundMs:160000,
      inputValue:protectedInput,
      outputsToRescue:[{ address:rescueAddress,value:rescuedValue }],
      continuingOutputs:[],
      mintedValue:{ [beacon]:'0' }
    }),
    /burn exactly one state beacon/
  );
});

test('adversarial lifecycle: protected value leakage is rejected',()=>{
  assert.throws(
    ()=>validateCardanoExecuteTransition({
      datum:approvedDatum(),
      validityLowerBoundMs:160000,
      inputValue:protectedInput,
      outputsToRescue:[{
        address:rescueAddress,
        value:{ lovelace:'9999999',[`${'55'.repeat(28)}.aa`]:'12' }
      }],
      continuingOutputs:[],
      mintedValue:{ [beacon]:'-1' }
    }),
    /exact protected vault value/
  );
});
