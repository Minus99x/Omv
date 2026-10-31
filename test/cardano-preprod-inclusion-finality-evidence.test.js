import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCardanoPreprodInclusionFinalityEvidence,
  verifyCardanoPreprodInclusionFinalityEvidence
} from '../src/chains/cardano/preprod-inclusion-finality-evidence.js';

function input(overrides={}){
  return {
    sourceAction:'heartbeat',
    transactionBodyHash:'ab'.repeat(32),
    sourceArtifactSha256:'cd'.repeat(32),
    inclusionObservation:{
      tipHash:'11'.repeat(32),
      tipSlot:1000,
      transactionSeen:true,
      sourceBlockStillCanonical:true,
      tipDescendsFromSourceBlock:true
    },
    laterObservation:{
      tipHash:'22'.repeat(32),
      tipSlot:1400,
      transactionSeen:true,
      sourceBlockStillCanonical:true,
      tipDescendsFromSourceBlock:true
    },
    policy:{
      minimumDepthSlots:300,
      requireCanonicalAncestry:true
    },
    ...overrides
  };
}

test('Cardano inclusion/finality evidence keeps inclusion and policy-level finality distinct',()=>{
  const args=input();
  const evidence=createCardanoPreprodInclusionFinalityEvidence(args);
  assert.equal(evidence.checks.exactTransactionInclusionObserved,true);
  assert.equal(evidence.checks.requiredSettlementDepthSatisfied,true);
  assert.equal(evidence.checks.inclusionAndFinalitySeparated,true);
  assert.equal(evidence.finalityPolicy.policyFinalitySatisfied,true);
  assert.equal(evidence.finalityPolicy.absoluteConsensusFinalityClaimed,false);
  assert.equal(evidence.liveActions.publicNetworkRecoveryProven,false);
  assert.equal(evidence.liveActions.supportClaimAuthorized,false);
  assert.match(evidence.evidenceSha256,/^[0-9a-f]{64}$/);

  const verified=verifyCardanoPreprodInclusionFinalityEvidence({ evidence,...args });
  assert.equal(verified.valid,true,verified.errors.join('; '));
});

test('Cardano finality evidence rejects mere inclusion without sufficient later depth',()=>{
  const args=input({
    laterObservation:{
      tipHash:'22'.repeat(32),
      tipSlot:1200,
      transactionSeen:true,
      sourceBlockStillCanonical:true,
      tipDescendsFromSourceBlock:true
    }
  });
  assert.throws(
    ()=>createCardanoPreprodInclusionFinalityEvidence(args),
    /below the configured finality policy threshold/
  );
});

test('Cardano finality evidence rejects a later tip that does not preserve canonical ancestry',()=>{
  const args=input({
    laterObservation:{
      tipHash:'22'.repeat(32),
      tipSlot:1400,
      transactionSeen:true,
      sourceBlockStillCanonical:false,
      tipDescendsFromSourceBlock:false
    }
  });
  assert.throws(
    ()=>createCardanoPreprodInclusionFinalityEvidence(args),
    /remains canonical and ancestral/
  );
});

test('Cardano finality evidence requires an explicit operator policy rather than silently inventing one',()=>{
  const args=input({ policy:{ minimumDepthSlots:300,requireCanonicalAncestry:false } });
  assert.throws(
    ()=>createCardanoPreprodInclusionFinalityEvidence(args),
    /must require canonical ancestry/
  );
});

test('Cardano finality rejects coercible slot and depth observations rather than fabricating settlement distance',()=>{
 const base=input();
 for(const wrong of [true,[],[1000],{valueOf(){return 1000;}},'01000','1000.0',1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>createCardanoPreprodInclusionFinalityEvidence({
   ...base,inclusionObservation:{...base.inclusionObservation,tipSlot:wrong}
  }),/canonical non-negative safe integer/);
 }
 for(const wrong of [true,[300],{},'0300',0,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>createCardanoPreprodInclusionFinalityEvidence({
   ...base,policy:{...base.policy,minimumDepthSlots:wrong}
  }),/canonical|positive safe integer/);
 }
 const allowed=createCardanoPreprodInclusionFinalityEvidence({
  ...base,inclusionObservation:{...base.inclusionObservation,tipSlot:'1000'},
  laterObservation:{...base.laterObservation,tipSlot:1400n},
  policy:{...base.policy,minimumDepthSlots:'300'}
 });
 assert.equal(allowed.finalityPolicy.minimumDepthSlots,300);
 assert.equal(allowed.inclusionObservation.tipSlot,1000);
});

test('Cardano finality refuses impossible identical hashes at distinct tip slots or noncanonical inclusion ancestry',()=>{
 const base=input();
 assert.throws(()=>createCardanoPreprodInclusionFinalityEvidence({
  ...base,laterObservation:{...base.laterObservation,tipHash:base.inclusionObservation.tipHash}
 }),/cannot reuse the same tip block hash/);
 for(const flag of ['sourceBlockStillCanonical','tipDescendsFromSourceBlock']){
  assert.throws(()=>createCardanoPreprodInclusionFinalityEvidence({
   ...base,inclusionObservation:{...base.inclusionObservation,[flag]:false}
  }),/canonical source block/);
 }
 let casts=0;
 const forged={toString(){casts++;return 'ab'.repeat(32);}};
 assert.throws(()=>createCardanoPreprodInclusionFinalityEvidence({
  ...base,transactionBodyHash:forged
 }),/32-byte hex/);
 assert.equal(casts,0,'identity coercion hooks must never run');
});
