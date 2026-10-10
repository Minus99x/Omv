import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCardanoPreprodCapturedLedger } from '../scripts/recheck-cardano-preprod-unsigned-ledger.js';

function fixture() {
  const hash='ab'.repeat(32), capturedSlot=135973880;
  const params={
    era:'Conway',protocolVersion:'11.0',
    minFeeA:'44',minFeeB:'155381',maxTxSize:16384,maxValueSize:5000,
    coinsPerUtxoByte:'4310',priceMemory:{numerator:'3',denominator:'50'},
    priceSteps:{numerator:'1',denominator:'100'},
    maxTxExUnits:{memory:'14000000',steps:'10000000000'},
    collateralPercentage:'150',maxCollateralInputs:3,
    plutusV3CostModel:Array(350).fill(0),
    epoch:316,sourceBlockHash:hash
  };
  const capturedSnapshot={
    network:'preprod',source:{independentSourceCount:2},
    promotion:{independentlyConfirmed:true},
    parameters:params,tip:{blockHash:hash,slot:capturedSlot}
  };
  const currentSnapshot={
    ...capturedSnapshot,
    parameters:{...params,epoch:316,sourceBlockHash:'cd'.repeat(32)},
    tip:{blockHash:'cd'.repeat(32),slot:capturedSlot+100}
  };
  const seed={transaction:{id:'11'.repeat(32)},index:0};
  const collateral={transaction:{id:'22'.repeat(32)},index:1};
  const capturedBinding={
    stableTip:{hash,slot:capturedSlot},
    roles:{
      seed:{reference:seed,address:'addr_test1_seed_fixture',lovelace:'20000000'},
      collateral:{reference:collateral,address:'addr_test1_collateral_fixture',lovelace:'5000000'}
    }
  };
  const currentUtxos=[
    {...seed,address:'addr_test1_seed_fixture',value:{ada:{lovelace:'20000000'}}},
    {...collateral,address:'addr_test1_collateral_fixture',value:{ada:{lovelace:'5000000'}}}
  ];
  const capturedCandidate={validity:{lowerSlot:capturedSlot-10,upperSlot:capturedSlot+1500}};
  const currentTip={hash:'cd'.repeat(32),slot:capturedSlot+100};
  return {capturedBinding,capturedSnapshot,currentSnapshot,capturedCandidate,currentUtxos,currentTip};
}
test('rechecks still-unspent exact old UTxOs at a new stable independently corroborated tip',()=>{
  const source=fixture();
  const result=compareCardanoPreprodCapturedLedger(source);
  assert.equal(result.ok,true);
  assert.equal(result.originalUTxOsUnspentAndUnchanged,true);
  assert.equal(result.independentlyCorroboratedProtocolValuesUnchanged,true);
  assert.equal(result.candidateStillWithinValidity,true);
  // A fixture-only comparison must never masquerade as fresh live-chain proof.
  assert.equal(result.currentStableTipAndUTxOStateChecked,false);
  assert.equal(result.liveOgmiosAndBlockfrostReadsPerformed,false);
  assert.equal(result.currentTwoSourceProtocolAgreement,false);
  assert.equal(result.validityUpperBoundExclusive,true);
  assert.equal(result.completePhaseOneValidated,false);
  assert.equal(result.originalUnsignedCandidateReadyForSigning,false);
  assert.equal(result.walletSigningAuthorized,false);
  assert.equal(result.transactionSubmissionAuthorized,false);
});
test('detects a seed spent after capture without pretending it was still unspent',()=>{
  const source=fixture();
  source.currentUtxos.shift();
  const result=compareCardanoPreprodCapturedLedger(source);
  assert.equal(result.seed.stillUnspent,false);
  assert.equal(result.originalUTxOsUnspentAndUnchanged,false);
  assert.match(result.nextGate,/UTxOs changed or spent/);
});
test('detects a changed collateral amount or address',()=>{
  const source=fixture();
  source.currentUtxos[1].value.ada.lovelace='4000000';
  const result=compareCardanoPreprodCapturedLedger(source);
  assert.equal(result.collateral.addressAndLovelaceUnchanged,false);
  assert.equal(result.originalUTxOsUnspentAndUnchanged,false);
});
test('detects native assets and datum-bearing old input references',()=>{
  const source=fixture();
  source.currentUtxos[0].datumHash='ff'.repeat(32);
  source.currentUtxos[1].value['aa'.repeat(28)]={bb:'1'};
  const result=compareCardanoPreprodCapturedLedger(source);
  assert.equal(result.seed.remainsPlainAdaOnly,false);
  assert.equal(result.collateral.remainsPlainAdaOnly,false);
});
test('detects changed independently agreed protocol parameters',()=>{
  const source=fixture();
  source.currentSnapshot.parameters.maxTxSize=16000;
  const result=compareCardanoPreprodCapturedLedger(source);
  assert.equal(result.independentlyCorroboratedProtocolValuesUnchanged,false);
  assert.match(result.nextGate,/protocol parameters changed/);
});
test('recognizes an expired candidate without granting signing permission',()=>{
  const source=fixture();
  source.currentTip.slot=135980000;
  const result=compareCardanoPreprodCapturedLedger(source);
  assert.equal(result.candidateStillWithinValidity,false);
  assert.equal(result.originalUnsignedCandidateReadyForSigning,false);
  assert.match(result.nextGate,/validity expired/);
});
test('rejects a stale provider tip or changed original capture bound tip',()=>{
  const source=fixture();
  source.currentTip.slot=135000000;
  assert.throws(()=>compareCardanoPreprodCapturedLedger(source),/older than captured/);
  source.currentTip.slot=135974000;
  source.capturedSnapshot.tip.blockHash='ff'.repeat(32);
  assert.throws(()=>compareCardanoPreprodCapturedLedger(source),/were not bound to one tip/);
});
test('rejects unexpected or duplicate UTxO response references',()=>{
  const source=fixture();
  source.currentUtxos.push({...source.currentUtxos[0]});
  assert.throws(()=>compareCardanoPreprodCapturedLedger(source),/duplicate UTxO reference/);
  source.currentUtxos.pop();
  source.currentUtxos.push({transaction:{id:'ff'.repeat(32)},index:0,address:'x',value:{ada:{lovelace:'1'}}});
  assert.throws(()=>compareCardanoPreprodCapturedLedger(source),/unexpected UTxO reference/);
});

test('Cardano invalidHereafter TTL is exclusive at the exact slot boundary',()=>{
  const source=fixture();
  const {lowerSlot,upperSlot}=source.capturedCandidate.validity;
  source.currentTip.slot=upperSlot-1;
  assert.equal(compareCardanoPreprodCapturedLedger(source).candidateStillWithinValidity,true);
  source.currentTip.slot=upperSlot;
  const atExpiry=compareCardanoPreprodCapturedLedger(source);
  assert.equal(atExpiry.candidateStillWithinValidity,false);
  assert.equal(atExpiry.validityUpperBoundExclusive,true);
  assert.match(atExpiry.nextGate,/validity expired/);
  source.currentTip.slot=lowerSlot;
  assert.equal(compareCardanoPreprodCapturedLedger(source).candidateStillWithinValidity,true);
  source.currentTip.slot=lowerSlot-1;
  assert.equal(compareCardanoPreprodCapturedLedger(source).candidateStillWithinValidity,false);
});
