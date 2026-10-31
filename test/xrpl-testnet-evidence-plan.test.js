import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createXrplTestnetPrimitiveEvidencePlan,
  getXrplPrimitiveEvidenceSpec
} from '../src/chains/xrpl/testnet-evidence-plan.js';

test('XRPL Testnet evidence plan keeps primitive proofs separate from exact OmegaVault recovery',()=>{
  const plan=createXrplTestnetPrimitiveEvidencePlan();
  assert.equal(plan.networkRef,'xrpl:testnet');
  assert.equal(plan.evidenceLevel,'public-testnet');
  assert.equal(plan.claimBoundary.exactOmegaVaultRecoveryProven,false);
  assert.equal(plan.claimBoundary.publicNetworkRecoveryProven,false);
  assert.equal(plan.claimBoundary.supportClaimAuthorized,false);
  assert.ok(plan.requiredFeatures.includes('PermissionDelegationV1_1'));
  assert.ok(plan.requiredFeatures.includes('BatchV1_1'));
  assert.ok(plan.requiredFeatures.includes('TicketBatch'));
});

test('XRPL primitive evidence plan fails closed on unknown primitive names',()=>{
  assert.throws(
    ()=>createXrplTestnetPrimitiveEvidencePlan({ primitives:['signerList','magicRecovery'] }),
    /unknown/
  );
});

test('XRPL feature activation must be observed on the target network rather than inferred from docs',()=>{
  const plan=createXrplTestnetPrimitiveEvidencePlan({ primitives:['permissionDelegation'] });
  assert.equal(plan.featurePolicy.queryTargetNetworkAtCaptureTime,true);
  assert.equal(plan.featurePolicy.documentationDoesNotEstablishActivation,true);
  assert.equal(plan.featurePolicy.unknownOrDisabledFeatureFailsClosed,true);
});

test('XRPL escrow evidence explicitly proves fixed-time semantics but not resettable inactivity or quorum',()=>{
  const escrow=getXrplPrimitiveEvidenceSpec('escrow');
  assert.ok(escrow.proves.includes('immutable-escrow-destination'));
  assert.ok(escrow.doesNotProve.includes('owner-resettable-inactivity'));
  assert.ok(escrow.doesNotProve.includes('trusted-contact-threshold'));
});

test('XRPL Ticket evidence proves one-use sequence reservation but not intent binding',()=>{
  const ticket=getXrplPrimitiveEvidenceSpec('ticket');
  assert.ok(ticket.proves.includes('one-use-sequence-reservation'));
  assert.ok(ticket.doesNotProve.includes('transaction-intent-binding'));
});

test('XRPL Batch evidence retains non-delegable outer transaction caution',()=>{
  const batch=getXrplPrimitiveEvidenceSpec('batch');
  assert.match(batch.caution,/non-delegable/i);
  assert.ok(batch.doesNotProve.includes('immutable-rescue'));
});


test('XRPL primitive evidence plans reject inherited Object property names and non-string keys',()=>{
  for(const name of ['constructor','toString','valueOf','__proto__','hasOwnProperty',42,{},null]){
    assert.throws(()=>createXrplTestnetPrimitiveEvidencePlan({primitives:[name]}),/is unknown/);
    assert.equal(getXrplPrimitiveEvidenceSpec(name),null);
  }
  assert.equal(getXrplPrimitiveEvidenceSpec('escrow').id,'escrow');
});

test('XRPL Testnet evidence scope rejects sparse, inherited and accessor-backed primitive selections',()=>{
  const sparse=['escrow',,'ticket'];
  assert.throws(()=>createXrplTestnetPrimitiveEvidencePlan({primitives:sparse}),/dense own-data/);
  const inherited=['escrow','ticket'];
  delete inherited[1];
  const proto=Object.create(Array.prototype);
  proto[1]='ticket';
  Object.setPrototypeOf(inherited,proto);
  assert.throws(()=>createXrplTestnetPrimitiveEvidencePlan({primitives:inherited}),/dense own-data/);
  let invoked=0;
  const accessor=['escrow','ticket'];
  Object.defineProperty(accessor,1,{enumerable:true,configurable:true,get(){invoked++;return 'ticket';}});
  assert.throws(()=>createXrplTestnetPrimitiveEvidencePlan({primitives:accessor}),/dense own-data/);
  assert.equal(invoked,0,'untrusted selection getter must never run');
});

test('XRPL Testnet evidence scope rejects undeclared own metadata while preserving canonical frozen inputs',()=>{
  const hidden=['escrow'];
  Object.defineProperty(hidden,'aux',{enumerable:false,value:'override'});
  assert.throws(()=>createXrplTestnetPrimitiveEvidencePlan({primitives:hidden}),/hidden or unexpected/);
  const symbol=['escrow'];
  symbol[Symbol('proof')]=true;
  assert.throws(()=>createXrplTestnetPrimitiveEvidencePlan({primitives:symbol}),/hidden or unexpected/);
  const plan=createXrplTestnetPrimitiveEvidencePlan({primitives:Object.freeze(['escrow','ticket'])});
  assert.deepEqual(plan.primitiveEvidence.map(x=>x.id),['escrow','ticket']);
  assert.deepEqual(plan.requiredFeatures,['Escrow','TicketBatch']);
  assert.equal(plan.claimBoundary.supportClaimAuthorized,false);
});
