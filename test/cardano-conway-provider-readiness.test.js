import test from 'node:test';
import assert from 'node:assert/strict';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { createCardanoPreprodConwayReadinessReport } from '../src/chains/cardano/conway-provider-readiness.js';

function fixture() {
  const tip = {hash:'ab'.repeat(32),slot:1005000};
  const ogmiosParameters = {
    maxBlockBodySize:{bytes:90112},
    maxBlockHeaderSize:{bytes:1100},
    stakeCredentialDeposit:{ada:{lovelace:2000000}},
    stakePoolDeposit:{ada:{lovelace:500000000}},
    desiredNumberOfStakePools:500,
    minStakePoolCost:{ada:{lovelace:170000000}},
    stakePoolRetirementEpochBound:18,
    stakePoolPledgeInfluence:'3/10',
    monetaryExpansion:'3/1000',
    treasuryExpansion:'1/5',
    maxExecutionUnitsPerBlock:{memory:62000000,cpu:20000000000},
    plutusCostModels:{
      'plutus:v1':Array(166).fill(0),
      'plutus:v2':Array(175).fill(1)
    }
  };
  const blockfrostParameters = {
    max_block_size:90112,max_block_header_size:1100,
    key_deposit:'2000000',pool_deposit:'500000000',
    n_opt:500,min_pool_cost:'170000000',
    e_max:18,a0:0.3,rho:0.003,tau:0.2,
    max_block_ex_mem:'62000000',max_block_ex_steps:'20000000000',
    cost_models_raw:{
      PlutusV1:Array(166).fill(0),
      PlutusV2:Array(175).fill(1)
    }
  };
  const protocolSnapshot={
    network:'preprod',
    source:{independentSourceCount:2},
    promotion:{independentlyConfirmed:true},
    tip:{blockHash:tip.hash,slot:tip.slot}
  };
  return {ogmiosParameters,blockfrostParameters,tipBefore:tip,tipAfter:{...tip},protocolSnapshot};
}
test('compares genuine two-source Conway overlap without manufacturing omitted genesis fields',()=>{
 const f=fixture();
 const r=createCardanoPreprodConwayReadinessReport(f);
 assert.equal(r.schema,'omegavault.cardano.preprod-conway-provider-readiness.v1');
 assert.equal(r.agreed.maxBlockBodySize,'90112');
 assert.equal(r.agreed.poolPledgeInfluence.numerator,'3');
 assert.equal(r.agreed.poolPledgeInfluence.denominator,'10');
 assert.deepEqual(r.agreed.maxBlockExUnits,{memory:'62000000',steps:'20000000000'});
 assert.equal(r.agreed.plutusV1CostModel.length,166);
 assert.equal(r.agreed.plutusV2CostModel.length,175);
 assert.match(r.unresolved.systemStart,/genesis/);
 assert.ok(Object.hasOwn(r.unresolved,'minFeeRefScriptCostPerByte'));
 assert.equal(r.coveredParameterCount,13);
 assert.equal(r.completeConwayParametersEstablished,false);
 assert.equal(r.completePhaseOneValidated,false);
 assert.equal(r.transactionSubmissionAuthorized,false);
 const {reportSha256,...core}=r;
 assert.equal(reportSha256,hashCardanoEvidence(core));
});
test('flags mismatched governance and consensus values rather than selecting a favorite provider',()=>{
 const f=fixture();f.blockfrostParameters.n_opt=501;
 const r=createCardanoPreprodConwayReadinessReport(f);
 assert.equal(r.agreed.desiredNumberOfStakePools,undefined);
 assert.deepEqual(r.mismatched.desiredNumberOfStakePools,{ogmios:'500',blockfrost:'501'});
 assert.equal(r.completeConwayParametersEstablished,false);
});
test('does not accept a silently missing protocol value as agreement',()=>{
 const f=fixture();
 delete f.blockfrostParameters.pool_deposit;
 const r=createCardanoPreprodConwayReadinessReport(f);
 assert.equal(r.agreed.poolDeposit,undefined);
 assert.match(r.unresolved.poolDeposit.blockfrost,/unsigned integer/);
});
test('rejects mismatched tip before or after the live capture',()=>{
 const f=fixture();f.tipAfter.slot++;
 assert.throws(()=>createCardanoPreprodConwayReadinessReport(f),/unchanged/);
});
test('rejects a single-source or unverified protocol snapshot',()=>{
 const f=fixture();f.protocolSnapshot.source.independentSourceCount=1;
 assert.throws(()=>createCardanoPreprodConwayReadinessReport(f),/two provider sources/);
});
test('checks ordered cost model coefficients across two providers',()=>{
 const f=fixture();f.blockfrostParameters.cost_models_raw.PlutusV2[174]=2;
 const r=createCardanoPreprodConwayReadinessReport(f);
 assert.equal(r.mismatched.plutusV2CostModel.ogmios[174],1);
 assert.equal(r.mismatched.plutusV2CostModel.blockfrost[174],2);
});
test('refuses loss of integer precision in a provider response',()=>{
 const f=fixture();f.ogmiosParameters.stakeCredentialDeposit.ada.lovelace=2**54;
 const r=createCardanoPreprodConwayReadinessReport(f);
 assert.match(r.unresolved.keyDeposit.ogmios,/without truncation/);
});
