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

function withConwayVoting(f) {
  f.ogmiosParameters.stakePoolVotingThresholds={
    noConfidence:'1/2',
    constitutionalCommittee:{default:'3/5',stateOfNoConfidence:'7/10'},
    hardForkInitiation:'2/5',
    protocolParametersUpdate:{security:'1/4'}
  };
  f.ogmiosParameters.delegateRepresentativeVotingThresholds={
    noConfidence:'1/2',
    constitutionalCommittee:{default:'3/5',stateOfNoConfidence:'7/10'},
    constitution:'2/5',
    hardForkInitiation:'1/4',
    protocolParametersUpdate:{
      network:'1/10',economic:'1/5',technical:'3/10',governance:'4/5'
    },
    treasuryWithdrawals:'9/10'
  };
  Object.assign(f.blockfrostParameters,{
    pvt_motion_no_confidence:0.5,pvt_committee_normal:0.6,
    pvt_committee_no_confidence:0.7,pvt_hard_fork_initiation:0.4,
    pvt_p_p_security_group:0.25,
    dvt_motion_no_confidence:0.5,dvt_committee_normal:0.6,
    dvt_committee_no_confidence:0.7,dvt_update_to_constitution:0.4,
    dvt_hard_fork_initiation:0.25,dvt_p_p_network_group:0.1,
    dvt_p_p_economic_group:0.2,dvt_p_p_technical_group:0.3,
    dvt_p_p_gov_group:0.8,dvt_treasury_withdrawal:0.9
  });
  return f;
}
test('two complete Conway voting groups agree using actual Ogmios and Blockfrost field paths',()=>{
  const report=createCardanoPreprodConwayReadinessReport(withConwayVoting(fixture()));
  assert.equal(report.coveredParameterCount,15);
  assert.equal(report.agreed.poolVotingThresholds.securityVotingThreshold.numerator,'1');
  assert.equal(report.agreed.poolVotingThresholds.securityVotingThreshold.denominator,'4');
  assert.equal(report.agreed.drepVotingThresholds.treasuryWithdrawal.numerator,'9');
  assert.equal(report.agreed.drepVotingThresholds.ppGovernanceGroup.denominator,'5');
  assert.equal(Object.hasOwn(report.unresolved,'poolVotingThresholds'),false);
  assert.equal(Object.hasOwn(report.unresolved,'drepVotingThresholds'),false);
  assert.equal(report.completeConwayParametersEstablished,false);
  assert.equal(report.transactionSubmissionAuthorized,false);
});
test('different DRep threshold is explicit mismatch, never partial agreement',()=>{
  const f=withConwayVoting(fixture());
  f.blockfrostParameters.dvt_p_p_gov_group=0.7;
  const report=createCardanoPreprodConwayReadinessReport(f);
  assert.equal(Object.hasOwn(report.agreed,'drepVotingThresholds'),false);
  assert.equal(report.mismatched.drepVotingThresholds.ogmios.ppGovernanceGroup.numerator,'4');
  assert.equal(report.mismatched.drepVotingThresholds.blockfrost.ppGovernanceGroup.numerator,'7');
  assert.equal(report.agreed.poolVotingThresholds.securityVotingThreshold.denominator,'4');
});
test('partial voting groups stay unresolved rather than being marked agreed',()=>{
  const f=withConwayVoting(fixture());
  delete f.blockfrostParameters.pvt_p_p_security_group;
  delete f.ogmiosParameters.delegateRepresentativeVotingThresholds.constitution;
  const report=createCardanoPreprodConwayReadinessReport(f);
  assert.equal(Object.hasOwn(report.agreed,'poolVotingThresholds'),false);
  assert.equal(Object.hasOwn(report.agreed,'drepVotingThresholds'),false);
  assert.match(report.unresolved.poolVotingThresholds.blockfrost,/securityVotingThreshold/);
  assert.match(report.unresolved.drepVotingThresholds.ogmios,/updateConstitution/);
  assert.equal(report.completeConwayParametersEstablished,false);
});
test('out-of-range governance ratios fail closed rather than normalizing them',()=>{
  const f=withConwayVoting(fixture());
  f.blockfrostParameters.dvt_treasury_withdrawal=1.2;
  const report=createCardanoPreprodConwayReadinessReport(f);
  assert.match(report.unresolved.drepVotingThresholds.blockfrost,/exceeds voting threshold 1/);
  assert.equal(Object.hasOwn(report.agreed,'drepVotingThresholds'),false);
  assert.equal(report.transactionSubmissionAuthorized,false);
});

test('oversized provider integers remain unresolved without expensive BigInt conversion',()=> {
  const f=fixture();
  f.ogmiosParameters.stakeCredentialDeposit.ada.lovelace='9'.repeat(100000);
  f.blockfrostParameters.max_block_ex_steps='9'.repeat(100000);
  const report=createCardanoPreprodConwayReadinessReport(f);
  assert.match(report.unresolved.keyDeposit.ogmios,/exceeds u64/);
  assert.match(report.unresolved.maxBlockExUnits,/exceeds u64/);
  assert.equal(report.agreed.keyDeposit,undefined);
  assert.equal(report.agreed.maxBlockExUnits,undefined);
  assert.equal(report.completeConwayParametersEstablished,false);
});

test('oversized Ogmios rational text cannot qualify as provider agreement',()=> {
  const f=fixture();
  f.ogmiosParameters.stakePoolPledgeInfluence='9'.repeat(100000)+'/10';
  const report=createCardanoPreprodConwayReadinessReport(f);
  assert.match(report.unresolved.poolPledgeInfluence.ogmios,/exceeds supported integer width/);
  assert.equal(report.agreed.poolPledgeInfluence,undefined);
  assert.equal(report.completeConwayParametersEstablished,false);
});
