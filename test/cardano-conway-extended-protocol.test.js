import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCardanoPreprodExtendedConwaySnapshot } from '../src/chains/cardano/conway-extended-protocol.js';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';

function fixture() {
  const cost = Array(350).fill(0);
  const hash = 'ab'.repeat(32);
  const baseSnapshot = {
    schemaVersion: 2,
    network:'preprod',networkId:0,
    tip:{blockHash:hash,slot:80000000,epoch:100},
    source:{independentSourceCount:2,provider:'Ogmios + Blockfrost'},
    promotion:{independentlyConfirmed:true,eligibleForLiveTransactionConstruction:false,connectorLiveProof:false},
    parameters:{
      era:'Conway',epoch:100,sourceBlockHash:hash,protocolVersion:'10.0',
      minFeeA:'44',minFeeB:'155381',maxTxSize:16384,maxValueSize:5000,
      coinsPerUtxoByte:'4310',priceMemory:{numerator:'577',denominator:'10000'},
      priceSteps:{numerator:'721',denominator:'10000000'},
      maxTxExUnits:{memory:'14000000',steps:'10000000000'},
      collateralPercentage:'150',maxCollateralInputs:3,
      plutusV3CostModel:cost,
      plutusV3CostModelSha256:createHash('sha256').update(JSON.stringify(cost)).digest('hex')
    }
  };
  const fraction = {numerator:'1',denominator:'2'};
  const poolThresholds = {
    motionNoConfidence:fraction,committeeNormal:fraction,committeeNoConfidence:fraction,
    hardForkInitiation:fraction,securityVotingThreshold:fraction
  };
  const drepThresholds = {
    motionNoConfidence:fraction,committeeNormal:fraction,committeeNoConfidence:fraction,
    updateConstitution:fraction,hardForkInitiation:fraction,ppNetworkGroup:fraction,
    ppEconomicGroup:fraction,ppTechnicalGroup:fraction,ppGovernanceGroup:fraction,
    treasuryWithdrawal:fraction
  };
  const complete = {
    systemStart:'2022-06-21T00:00:00Z',epochLength:432000,slotLength:1,
    maxBlockBodySize:90112,maxBlockHeaderSize:1100,keyDeposit:'2000000',
    poolDeposit:'500000000',desiredNumberOfStakePools:500,minPoolCost:'340000000',
    maxBlockExUnits:{memory:'62000000',steps:'40000000000'},
    maximumEpoch:18,poolPledgeInfluence:fraction,
    expansionRate:fraction,treasuryGrowthRate:fraction,
    poolVotingThresholds:poolThresholds,drepVotingThresholds:drepThresholds,
    minCommitteeSize:1,committeeTermLimit:100,
    governanceActionValidityPeriod:100,governanceActionDeposit:'100000000000',
    drepDeposit:'500000000',drepInactivityPeriod:20,
    minFeeRefScriptCostPerByte:fraction,
    plutusV1CostModel:Array(166).fill(0),
    plutusV2CostModel:Array(175).fill(0)
  };
  return {
    baseSnapshot,
    ogmiosCompleteConway:structuredClone(complete),
    blockfrostCompleteConway:structuredClone(complete),
    observedTipBefore:{hash,slot:80000000},
    observedTipAfter:{hash,slot:80000000}
  };
}
test('binds two matching complete Conway parameter sources at stable tip',()=>{
  const args=fixture();
  const out=createCardanoPreprodExtendedConwaySnapshot(args);
  assert.equal(out.parameters.completeConwayAgreement.independentSourceCount,2);
  assert.equal(out.parameters.completeConwayAgreement.ogmiosSha256,hashCardanoEvidence(args.ogmiosCompleteConway));
  assert.equal(out.parameters.completeConwayAgreement.blockfrostSha256,hashCardanoEvidence(args.blockfrostCompleteConway));
  assert.equal(out.parameters.completeConwayAgreement.acquiredStableTipHash,args.baseSnapshot.tip.blockHash);
  assert.equal(out.promotion.eligibleForLiveTransactionConstruction,false);
  assert.equal(out.parameters.completeConway.plutusV2CostModel.length,175);
});
test('rejects independently collected provider disagreement even in unused governance field',()=>{
  const args=fixture();
  args.blockfrostCompleteConway.governanceActionDeposit='100000000001';
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/independent Conway protocol sources disagree/);
});
test('rejects stable-tip drift while collecting full parameters',()=>{
  const args=fixture();
  args.observedTipAfter.slot++;
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/unchanged current Cardano ledger tip/);
});
test('rejects a missing required Conway parameter rather than assuming mainnet values',()=>{
  const args=fixture();
  delete args.ogmiosCompleteConway.governanceActionDeposit;
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/missing complete Conway parameter: governanceActionDeposit/);
});
test('rejects incomplete V1/V2 model rather than inventing coefficients',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.plutusV2CostModel.pop();
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/exactly 175 ordered coefficients/);
});
test('rejects source count without independent provider corroboration',()=>{
  const args=fixture();
  args.baseSnapshot.source.independentSourceCount=1;
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/independently confirmed Preprod V2/);
});
test('deep-copies source before computing commitment so caller cannot mutate it later',()=>{
  const args=fixture();
  const result=createCardanoPreprodExtendedConwaySnapshot(args);
  args.ogmiosCompleteConway.systemStart='2000-01-01T00:00:00Z';
  assert.equal(result.parameters.completeConway.systemStart,'2022-06-21T00:00:00Z');
});

test('matching but impossible Conway genesis dates cannot pass two-source agreement',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.systemStart='2026-02-30T00:00:00Z';
  args.blockfrostCompleteConway.systemStart='2026-02-30T00:00:00Z';
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/systemStart.*valid calendar time/);
});
test('matching zero epoch lengths are not usable as ledger timing evidence',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.epochLength=0;
  args.blockfrostCompleteConway.epochLength=0;
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/epochLength.*supported ledger integer range/);
});
test('matching nonintegral slot lengths are rejected before digest binding',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.slotLength='1.5';
  args.blockfrostCompleteConway.slotLength='1.5';
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/slotLength.*exact non-negative integer/);
});
test('matching out-of-range u32 block limits cannot be accepted',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.maxBlockBodySize=4294967296;
  args.blockfrostCompleteConway.maxBlockBodySize=4294967296;
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/maxBlockBodySize.*supported ledger integer range/);
});
test('matching unsafe floating-point integers cannot be promoted as exact parameters',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.governanceActionDeposit=2**54;
  args.blockfrostCompleteConway.governanceActionDeposit=2**54;
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/governanceActionDeposit.*exact non-negative integer/);
});
test('matching zero denominators cannot become Conway rational evidence',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.expansionRate={numerator:'1',denominator:'0'};
  args.blockfrostCompleteConway.expansionRate={numerator:'1',denominator:'0'};
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/expansionRate.denominator.*supported ledger integer range/);
});
test('matching out-of-range governance voting thresholds still fail',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.drepVotingThresholds.treasuryWithdrawal={numerator:'2',denominator:'1'};
  args.blockfrostCompleteConway.drepVotingThresholds.treasuryWithdrawal={numerator:'2',denominator:'1'};
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/treasuryWithdrawal.*between 0 and 1/);
});
test('matching incomplete governance groups are rejected even when both sources omit same field',()=>{
  const args=fixture();
  delete args.ogmiosCompleteConway.poolVotingThresholds.securityVotingThreshold;
  delete args.blockfrostCompleteConway.poolVotingThresholds.securityVotingThreshold;
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/securityVotingThreshold.*normalized rational object/);
});
test('matching zero execution-unit budgets do not qualify for Conway snapshot',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.maxBlockExUnits.memory='0';
  args.blockfrostCompleteConway.maxBlockExUnits.memory='0';
  assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/maxBlockExUnits.memory.*supported ledger integer range/);
});
test('valid offset RFC3339 system start remains accepted without assuming UTC string formatting',()=>{
  const args=fixture();
  args.ogmiosCompleteConway.systemStart='2022-06-20T17:00:00-07:00';
  args.blockfrostCompleteConway.systemStart='2022-06-20T17:00:00-07:00';
  const report=createCardanoPreprodExtendedConwaySnapshot(args);
  assert.equal(report.parameters.completeConway.systemStart,'2022-06-20T17:00:00-07:00');
  assert.equal(report.parameters.completeConwayAgreement.submissionAuthorized,false);
});

test('matching oversized Conway integers are rejected before BigInt parsing',()=> {
  const args=fixture();
  for (const source of [args.ogmiosCompleteConway,args.blockfrostCompleteConway]) {
    source.governanceActionDeposit='9'.repeat(100000);
  }
  assert.throws(
    ()=>createCardanoPreprodExtendedConwaySnapshot(args),
    /governanceActionDeposit.*supported ledger integer range/
  );
});

test('matching oversized Conway rational components are rejected before BigInt parsing',()=> {
  const args=fixture();
  for (const source of [args.ogmiosCompleteConway,args.blockfrostCompleteConway]) {
    source.drepVotingThresholds.treasuryWithdrawal={numerator:'9'.repeat(100000),denominator:'10'};
  }
  assert.throws(
    ()=>createCardanoPreprodExtendedConwaySnapshot(args),
    /treasuryWithdrawal.numerator.*supported ledger integer range/
  );
});

function pv11Fixture() {
  const args=fixture();
  args.baseSnapshot.parameters.protocolVersion='11.0';
  for (const source of [args.ogmiosCompleteConway,args.blockfrostCompleteConway]) {
    source.plutusV1CostModel=Array.from({length:332},(_,i)=>i-166);
    source.plutusV2CostModel=Array.from({length:332},(_,i)=>i-175);
    source.minFeeRefScriptCostPerByte={numerator:'15',denominator:'1'};
  }
  return args;
}
test('PV11 binds every expanded V1/V2 coefficient and a reference fee above one',()=>{
  const args=pv11Fixture();
  const out=createCardanoPreprodExtendedConwaySnapshot(args);
  for (const name of ['plutusV1CostModel','plutusV2CostModel'])
    assert.deepEqual(out.parameters.completeConway[name],args.ogmiosCompleteConway[name]);
  assert.deepEqual(out.parameters.completeConway.minFeeRefScriptCostPerByte,{numerator:'15',denominator:'1'});
  assert.equal(out.parameters.completeConwayAgreement.submissionAuthorized,false);
});
for (const key of ['plutusV1CostModel','plutusV2CostModel']) {
  test(`PV11 rejects truncated, sparse, unsafe and mismatched ${key}`,()=>{
    for (const alter of [a=>a.pop(),a=>delete a[331],a=>{a[331]=Number.MAX_SAFE_INTEGER+1;}]) {
      const args=pv11Fixture();
      for (const source of [args.ogmiosCompleteConway,args.blockfrostCompleteConway]) alter(source[key]);
      assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/exactly 332 ordered coefficients/);
    }
    const args=pv11Fixture();
    args.blockfrostCompleteConway[key][331]++;
    assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/sources disagree/);
  });
  test(`PV10 rejects expanded ${key} rather than guessing a protocol upgrade`,()=>{
    const args=pv11Fixture();
    args.baseSnapshot.parameters.protocolVersion='10.0';
    assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/ordered coefficients/);
  });
}
test('reference-script prices allow non-unit fractions but reject negative, zero denominator and overflow',()=>{
  for (const price of [{numerator:'31',denominator:'2'},{numerator:'0',denominator:'1'}]) {
    const args=pv11Fixture();
    for (const source of [args.ogmiosCompleteConway,args.blockfrostCompleteConway]) source.minFeeRefScriptCostPerByte=price;
    assert.deepEqual(createCardanoPreprodExtendedConwaySnapshot(args).parameters.completeConway.minFeeRefScriptCostPerByte,price);
  }
  for (const price of [{numerator:'-1',denominator:'1'},{numerator:'15',denominator:'0'},{numerator:'18446744073709551616',denominator:'1'}]) {
    const args=pv11Fixture();
    for (const source of [args.ogmiosCompleteConway,args.blockfrostCompleteConway]) source.minFeeRefScriptCostPerByte=price;
    assert.throws(()=>createCardanoPreprodExtendedConwaySnapshot(args),/minFeeRefScriptCostPerByte/);
  }
});
