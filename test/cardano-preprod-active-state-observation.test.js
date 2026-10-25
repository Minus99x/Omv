import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDANO_APPLIED_FIXTURE, createCardanoVaultDatumData } from '../src/chains/cardano/transaction-body.js';
import {
  createCardanoPreprodActiveStateEvidence,
  verifyCardanoPreprodActiveStateEvidence
} from '../src/chains/cardano/preprod-active-state-observation.js';

const owner='11'.repeat(28);
const rescue='66'.repeat(28);
const contactA='22'.repeat(28);
const contactB='33'.repeat(28);
const bodyHash='ab'.repeat(32);
const validatorIdentitySha256='cd'.repeat(32);
const sourceArtifactSha256='ef'.repeat(32);
const lastHeartbeatMs=1655769700000;

function observedState(approvals=[]){
  const datum=createCardanoVaultDatumData({
    ownerKeyHash:owner,
    rescueKeyHash:rescue,
    contactKeyHashes:[contactA,contactB],
    threshold:2,
    inactivityMs:60000,
    lastHeartbeatMs,
    approvalKeyHashes:approvals
  });
  return {
    transaction:{ id:bodyHash },
    index:0,
    address:CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress,
    value:{
      ada:{ lovelace:'10000000' },
      [CARDANO_APPLIED_FIXTURE.beaconPolicyId]:{
        [CARDANO_APPLIED_FIXTURE.assetNameHex]:1
      }
    },
    datum:Buffer.from(datum.to_bytes()).toString('hex')
  };
}

function input(sourceAction,approvals=[]){
  return {
    sourceAction,
    sourceArtifactSha256,
    transactionBodyHash:bodyHash,
    validatorIdentitySha256,
    observedTip:{ hash:'12'.repeat(32),slot:100000200 },
    observedStateUtxo:observedState(approvals),
    recoveryAddress:CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress,
    beaconPolicyId:CARDANO_APPLIED_FIXTURE.beaconPolicyId,
    beaconAssetNameHex:CARDANO_APPLIED_FIXTURE.assetNameHex,
    ownerPaymentKeyHash:owner,
    rescueKeyHash:rescue,
    contactKeyHashes:[contactA,contactB],
    threshold:2,
    inactivityMs:60000,
    stateLovelace:'10000000',
    lastHeartbeatMs,
    approvalKeyHashes:approvals
  };
}

test('active-state observation binds an included heartbeat state without claiming finality',()=>{
  const args=input('heartbeat',[]);
  const evidence=createCardanoPreprodActiveStateEvidence(args);
  assert.equal(evidence.sourceAction,'heartbeat');
  assert.deepEqual(evidence.state.approvalKeyHashes,[]);
  assert.equal(evidence.checks.exactActiveStateObserved,true);
  assert.equal(evidence.checks.inclusionObserved,true);
  assert.equal(evidence.checks.finalityProven,false);
  assert.equal(evidence.liveActions.transactionSubmissionPerformed,true);
  assert.equal(evidence.liveActions.supportClaimAuthorized,false);
  assert.match(evidence.stateEvidenceSha256,/^[0-9a-f]{64}$/);

  const verified=verifyCardanoPreprodActiveStateEvidence({ evidence,...args });
  assert.equal(verified.valid,true,verified.errors.join('; '));
});

test('active-state observation binds accumulated contact approval state',()=>{
  const evidence=createCardanoPreprodActiveStateEvidence(input('approve',[contactA]));
  assert.deepEqual(evidence.state.approvalKeyHashes,[contactA]);
  assert.equal(evidence.nextGate,'build-next-approval-or-threshold-execute-from-this-exact-state');
});

test('heartbeat observation rejects retained approvals',()=>{
  assert.throws(
    ()=>createCardanoPreprodActiveStateEvidence(input('heartbeat',[contactA])),
    /must clear all approvals/
  );
});

test('active-state observation rejects datum drift',()=>{
  const args=input('approve',[contactA]);
  args.observedStateUtxo={ ...args.observedStateUtxo,datum:'d87980' };
  assert.throws(
    ()=>createCardanoPreprodActiveStateEvidence(args),
    /inline datum does not exactly reproduce/
  );
});

test('active-state observation rejects coercive recovery-policy integer inputs',()=>{
  for(const invalid of [
    { threshold:true },
    { inactivityMs:true },
    { threshold:'0x2' },
    { inactivityMs:'6e4' }
  ]){
    assert.throws(
      ()=>createCardanoPreprodActiveStateEvidence({ ...input('heartbeat',[]),...invalid }),
      /must be a positive safe integer/
    );
  }
});

test('active-state observation rejects protected-value leakage or extra assets',()=>{
  const args=input('approve',[contactA]);
  args.observedStateUtxo={
    ...args.observedStateUtxo,
    value:{
      ...args.observedStateUtxo.value,
      ada:{ lovelace:'9999999' }
    }
  };
  assert.throws(
    ()=>createCardanoPreprodActiveStateEvidence(args),
    /lovelace does not match/
  );

  const extra=input('approve',[contactA]);
  extra.observedStateUtxo={
    ...extra.observedStateUtxo,
    value:{
      ...extra.observedStateUtxo.value,
      ['77'.repeat(28)]:{ aa:1 }
    }
  };
  assert.throws(
    ()=>createCardanoPreprodActiveStateEvidence(extra),
    /exactly ADA plus the one bound state-beacon policy/
  );
});

test('active-state observation rejects coerced tip slots and output indices without executing conversion hooks',()=>{
  const base=input('heartbeat',[]);
  let coercions=0;
  const trap={valueOf(){coercions++;return 100000200;},toString(){coercions++;return '0';}};
  for(const invalid of [null,false,true,[],['0'],{},trap,'',' 0 ','00','01','0x1','1e2',-1,1.5,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>createCardanoPreprodActiveStateEvidence({
      ...base,observedTip:{...base.observedTip,slot:invalid}
    }),/observedTip.slot must be a non-negative safe integer/);
    assert.throws(()=>createCardanoPreprodActiveStateEvidence({
      ...base,observedStateUtxo:{...base.observedStateUtxo,index:invalid}
    }),/observedStateUtxo.index must be a non-negative safe integer/);
  }
  assert.equal(coercions,0,'untrusted index conversion hooks must never run');
});

test('active-state observation accepts canonical decimal index strings and normalized uppercase hashes',()=>{
  const base=input('heartbeat',[]);
  const canonical={
    ...base,
    observedTip:{hash:base.observedTip.hash.toUpperCase(),slot:'100000200'},
    observedStateUtxo:{
      ...base.observedStateUtxo,
      transaction:{id:base.transactionBodyHash.toUpperCase()},
      index:'0'
    },
    transactionBodyHash:base.transactionBodyHash.toUpperCase()
  };
  const result=createCardanoPreprodActiveStateEvidence(canonical);
  assert.equal(result.observedTip.slot,100000200);
  assert.equal(result.observedTip.hash,base.observedTip.hash);
  assert.equal(result.stateReference.index,0);
  assert.equal(result.stateReference.transaction.id,base.transactionBodyHash);
  assert.equal(verifyCardanoPreprodActiveStateEvidence({evidence:result,...canonical}).valid,true);
});

test('active-state observation rejects hash identity containers without calling toString',()=>{
  const base=input('heartbeat',[]);
  let coercions=0;
  const trap={toString(){coercions++;return base.transactionBodyHash;}};
  for(const [field,valid] of [
    ['sourceArtifactSha256',base.sourceArtifactSha256],
    ['transactionBodyHash',base.transactionBodyHash],
    ['validatorIdentitySha256',base.validatorIdentitySha256],
    ['ownerPaymentKeyHash',base.ownerPaymentKeyHash],
    ['rescueKeyHash',base.rescueKeyHash],
    ['beaconPolicyId',base.beaconPolicyId]
  ]){
    for(const invalid of [[valid],new String(valid),trap]){
      assert.throws(()=>createCardanoPreprodActiveStateEvidence({
        ...base,[field]:invalid
      }),/must be (28-byte hex|SHA-256\/32-byte hex)/,field);
    }
  }
  for(const invalid of [[base.observedTip.hash],trap]){
    assert.throws(()=>createCardanoPreprodActiveStateEvidence({
      ...base,observedTip:{...base.observedTip,hash:invalid}
    }),/observedTip.hash must be SHA-256\/32-byte hex/);
  }
  for(const invalid of [[base.transactionBodyHash],trap]){
    assert.throws(()=>createCardanoPreprodActiveStateEvidence({
      ...base,observedStateUtxo:{...base.observedStateUtxo,transaction:{id:invalid}}
    }),/observedStateUtxo.transaction.id must be SHA-256\/32-byte hex/);
  }
  assert.equal(coercions,0,'untrusted hash conversion hooks must never run');
});

test('active-state observation rejects spoofed validator address and inline datum identity',()=>{
  const base=input('heartbeat',[]);
  let coercions=0;
  const addressTrap={toString(){coercions++;return base.recoveryAddress;}};
  const datumTrap={toString(){coercions++;return base.observedStateUtxo.datum;}};
  for(const invalid of [[base.recoveryAddress],addressTrap]){
    assert.throws(()=>createCardanoPreprodActiveStateEvidence({
      ...base,observedStateUtxo:{...base.observedStateUtxo,address:invalid}
    }),/bound recovery validator address/);
    assert.throws(()=>createCardanoPreprodActiveStateEvidence({
      ...base,recoveryAddress:invalid
    }),/bound recovery validator address/);
  }
  for(const invalid of [[base.observedStateUtxo.datum],datumTrap]){
    assert.throws(()=>createCardanoPreprodActiveStateEvidence({
      ...base,observedStateUtxo:{...base.observedStateUtxo,datum:invalid}
    }),/inline datum does not exactly reproduce/);
  }
  assert.equal(coercions,0,'untrusted address/datum conversion hooks must never run');
});
