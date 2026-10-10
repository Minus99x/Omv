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
