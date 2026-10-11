import test from 'node:test';
import assert from 'node:assert/strict';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import {
  PREPROD_SHELLEY_GENESIS_HASH,PREPROD_CONWAY_GENESIS_HASH
} from '../src/chains/cardano/preprod-genesis-timing.js';
import { reconcileCardanoPreprodEraTiming } from '../src/chains/cardano/preprod-era-timing-reconciliation.js';

const startTime='2022-06-01T00:00:00Z';
function genesis() {
  const core={
    schema:'omegavault.cardano.preprod-public-genesis-timing.v1',
    network:'preprod',
    genesis:{
      shelleyBlake2b256:PREPROD_SHELLEY_GENESIS_HASH,
      conwayBlake2b256:PREPROD_CONWAY_GENESIS_HASH,
      rawGenesisBytesVerified:true
    },
    timing:{systemStart:startTime,epochLength:432000,slotLength:1},
    authenticPublishedGenesisProvenanceChecked:true,
    completePhaseOneValidated:false,
    transactionSubmissionAuthorized:false
  };
  return {...core,reportSha256:hashCardanoEvidence(core)};
}
function bound(slot,epoch,seconds=slot) {
  return {slot,epoch,time:{seconds}};
}
function input() {
  return {
    genesisReport:genesis(),
    networkStartTime:startTime,
    eraSummaries:[
      {start:bound(0,0),end:bound(864000,2),
        parameters:{epochLength:432000,slotLength:{milliseconds:1000},safeZone:100}},
      {start:bound(864000,2),parameters:{epochLength:432000,slotLength:{milliseconds:1000},safeZone:100}}
    ],
    stableTip:{hash:'ab'.repeat(32),slot:864123},
    observedEpoch:2
  };
}
test('reconciles hash-pinned genesis and node era boundaries at stable observed epoch without phase-one claims',()=>{
  const value=input();
  const result=reconcileCardanoPreprodEraTiming(value);
  assert.equal(result.observedNodeGenesisStartAgreesWithPublicGenesis,true);
  assert.equal(result.observedEpochAgreesWithEraSummaries,true);
  assert.equal(result.originalShelleyEraTimingPresent,true);
  assert.equal(result.currentEraEpochLength,432000);
  assert.equal(result.currentEraSlotLengthMilliseconds,1000);
  assert.equal(result.derivedCurrentSlotStartUtc,new Date(Date.parse(startTime)+864123000).toISOString());
  assert.equal(result.completePhaseOneValidated,false);
  assert.equal(result.independentlyVerifiedCurrentEraTiming,false);
  assert.equal(result.walletSigningAuthorized,false);
  assert.equal(result.transactionSubmissionAuthorized,false);
  const {reportSha256,...core}=result;
  assert.equal(reportSha256,hashCardanoEvidence(core));
});
test('rejects tampered or manufactured digest for a pinned genesis timing report',()=>{
  const x=input();
  x.genesisReport.timing.epochLength=200;
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/Authentic pinned Preprod public genesis/);
  const y=input();
  y.genesisReport.reportSha256='ff'.repeat(32);
  assert.throws(()=>reconcileCardanoPreprodEraTiming(y),/digest no longer reproduces/);
});
test('rejects a network start time different from published genesis',()=>{
  const x=input();
  x.networkStartTime='2022-06-02T00:00:00Z';
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/network start time disagrees/);
});
test('rejects fabricated current epoch even when ledger tip is in reported era',()=>{
  const x=input();
  x.observedEpoch=3;
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/observed epoch disagrees/);
});
test('rejects gaps, overlaps, and missing final known era boundary',()=>{
  const x=input();
  x.eraSummaries[1].start=bound(864001,2);
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/gap, overlap, or broken boundary/);
  const y=input();
  y.eraSummaries[0].end=null;
  assert.throws(()=>reconcileCardanoPreprodEraTiming(y),/gap, overlap, or broken boundary/);
});
test('rejects zero slot length and unsafe era length',()=>{
  const x=input();
  x.eraSummaries[1].parameters.slotLength.milliseconds=0;
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/positive safe integer/);
  const y=input();
  y.eraSummaries[0].parameters.epochLength=2**55;
  assert.throws(()=>reconcileCardanoPreprodEraTiming(y),/positive safe integer/);
});
test('rejects malformed tip or a tip outside any reported era interval',()=>{
  const x=input();
  x.stableTip.hash='xyz';
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/authenticated ledger tip/);
  const y=input();
  // This must be a mathematically sound end of the known era, so the
  // out-of-coverage guard is tested rather than boundary arithmetic.
  y.eraSummaries[1].end=bound(1296000,3);
  y.stableTip.slot=1296001;
  assert.throws(()=>reconcileCardanoPreprodEraTiming(y),/not in exactly one/);
});
test('does not accept a genesis report which authorizes signing or submission',()=>{
  const x=input();
  x.genesisReport.transactionSubmissionAuthorized=true;
  x.genesisReport.reportSha256=hashCardanoEvidence(
    Object.fromEntries(Object.entries(x.genesisReport).filter(([k])=>k!=='reportSha256'))
  );
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/Authentic pinned Preprod public genesis/);
});

test('rejects mutually matching but physically impossible era boundary seconds',()=>{
  const x=input();
  x.eraSummaries[0].end.time.seconds=864001;
  x.eraSummaries[1].start.time.seconds=864001;
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/boundary time disagrees with slot length/);
});
test('rejects era boundary epochs that contradict elapsed slots',()=>{
  const x=input();
  x.eraSummaries[0].end.epoch=3;
  x.eraSummaries[1].start.epoch=3;
  x.observedEpoch=3;
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/boundary epochs disagree with slot count/);
});
test('rejects fractional epoch boundaries even when reported epoch number agrees',()=>{
  const x=input();
  x.eraSummaries[0].end=bound(863999,2);
  x.eraSummaries[1].start=bound(863999,2);
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/boundary epochs disagree with slot count/);
});
test('rejects node network start that omits time or UTC offset',()=>{
  const x=input();
  x.networkStartTime='2022-06-01';
  assert.throws(()=>reconcileCardanoPreprodEraTiming(x),/network start time disagrees/);
});
test('accepts internally consistent Byron-style slotting followed by Shelley timing',()=>{
  const x=input();
  x.eraSummaries=[
    {start:bound(0,0,0),end:bound(4492800,208,89856000),
      parameters:{epochLength:21600,slotLength:{milliseconds:20000}}},
    {start:bound(4492800,208,89856000),
      parameters:{epochLength:432000,slotLength:{milliseconds:1000}}}
  ];
  x.stableTip.slot=4492801;
  x.observedEpoch=208;
  const report=reconcileCardanoPreprodEraTiming(x);
  assert.equal(report.currentEpoch,208);
  assert.equal(report.currentEraSlotLengthMilliseconds,1000);
  assert.equal(report.derivedCurrentSlotStartUtc,new Date(Date.parse(startTime)+89856001000).toISOString());
  assert.equal(report.completePhaseOneValidated,false);
});
