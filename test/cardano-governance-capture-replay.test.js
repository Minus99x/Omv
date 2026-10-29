import {normalizeCardanoProtocolParameterSnapshot} from '../src/chains/cardano/protocol-parameters.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {blockfrostProtocolFixture,ogmiosProtocolFixture} from './fixtures/cardano-provider-protocol.js';
import {createCardanoPreprodLiveProtocolSnapshot,verifyCapturedBlockfrostAgreement} from '../src/chains/cardano/live-protocol-parameters.js';
import {createCardanoPreprodConwayReadinessReport} from '../src/chains/cardano/conway-provider-readiness.js';
import {createScalusCapturedProtocolContext} from '../src/chains/cardano/scalus-protocol-context.js';
const tip={hash:'ab'.repeat(32),slot:135700000};
function inputs() {
  const blockfrostParameters=blockfrostProtocolFixture();
  return {blockfrostParameters,ogmiosParameters:ogmiosProtocolFixture(blockfrostParameters),epoch:400,tip};
}
function api() {
  return {ProtocolParams:{fromBlockfrostJson:JSON.parse},CardanoInfo:{preprod:()=>({
    protocolParams:{toBlockfrostJson:()=>{const {epoch,...parameters}=blockfrostProtocolFixture();return JSON.stringify(parameters);}},
    withProtocolParams:params=>({params})})}};
}
const governanceKeys=['committee_min_size','committee_max_term_length','gov_action_lifetime',
  'gov_action_deposit','drep_deposit','drep_activity',
  'pvt_motion_no_confidence','pvt_committee_normal','pvt_committee_no_confidence','pvt_hard_fork_initiation','pvt_p_p_security_group',
  'dvt_motion_no_confidence','dvt_committee_normal','dvt_committee_no_confidence','dvt_update_to_constitution',
  'dvt_hard_fork_initiation','dvt_p_p_network_group','dvt_p_p_economic_group','dvt_p_p_technical_group','dvt_p_p_gov_group','dvt_treasury_withdrawal'];

test('capture and replay compare every governance field and complete PV11 older-language cost models',()=>{
  const i=inputs();i.ogmiosParameters.stakePoolVotingThresholds.noConfidence='51/100';
  i.ogmiosParameters.delegateRepresentativeVotingThresholds.treasuryWithdrawals='9/10';
  const snapshot=createCardanoPreprodLiveProtocolSnapshot(i);
  for(const key of [...governanceKeys,'cost_models_raw.PlutusV1','cost_models_raw.PlutusV2']) {
    assert.ok(snapshot.confirmedAdditionalFields.includes(key),key);
  }
  const readiness=createCardanoPreprodConwayReadinessReport({...i,tipBefore:tip,tipAfter:tip,protocolSnapshot:snapshot});
  assert.equal(readiness.agreed.plutusV1CostModel.length,332);
  assert.equal(readiness.agreed.plutusV2CostModel[331],365);
  assert.deepEqual(Object.keys(readiness.mismatched),[]);
  const {context,cardanoInfo}=createScalusCapturedProtocolContext(snapshot,api());
  assert.deepEqual(cardanoInfo.params,snapshot.capturedBlockfrostParameters);
  assert.deepEqual(context.unconfirmedFields,[]);
  assert.deepEqual(context.referenceScriptFeeSchedule,{range:'25600',multiplier:{numerator:'6',denominator:'5'},base:{numerator:'15',denominator:'1'}});
  assert.equal(context.additionalFieldsIndependentlyConfirmed,true);
  assert.equal(context.completeCurrentProtocolContext,false);
});
for(const key of governanceKeys) {
  test(`capture and replay fail closed for conflicting or missing ${key}`,()=>{
    for(const bad of [null,undefined,'2']) {
      const i=inputs();i.blockfrostParameters[key]=bad;
      assert.throws(()=>createCardanoPreprodLiveProtocolSnapshot(i));
      const snapshot=structuredClone(createCardanoPreprodLiveProtocolSnapshot(inputs()));
      snapshot.capturedBlockfrostParameters[key]=bad;
      snapshot.confirmedAdditionalFields=governanceKeys; // labels cannot substitute for comparison
      assert.throws(()=>createScalusCapturedProtocolContext(snapshot,api()));
    }
  });
}
test('whole missing governance group on either provider cannot evade partial-field checks',()=>{
  for(const group of ['stakePoolVotingThresholds','delegateRepresentativeVotingThresholds']) {
    const i=inputs();delete i.ogmiosParameters[group];
    assert.throws(()=>createCardanoPreprodLiveProtocolSnapshot(i),/Incomplete or invalid/);
  }
});
test('PV11 cost models compare all 332 entries and reject legacy truncation, holes and unsafe numbers',()=>{
  for(const [language,legacy] of [['PlutusV1',166],['PlutusV2',175]]) {
    for(const mutate of [m=>m[331]++,m=>m.splice(legacy),m=>delete m[42],m=>m[42]=2**54]) {
      const i=inputs();mutate(i.blockfrostParameters.cost_models_raw[language]);
      assert.throws(()=>createCardanoPreprodLiveProtocolSnapshot(i));
    }
    const snapshot=structuredClone(createCardanoPreprodLiveProtocolSnapshot(inputs()));
    snapshot.capturedBlockfrostParameters.cost_models_raw[language][331]++;
    assert.throws(()=>verifyCapturedBlockfrostAgreement(snapshot,snapshot.capturedBlockfrostParameters),/disagreement/);
  }
});
test('matching sparse provider models never count as agreement',()=>{
  const i=inputs();
  delete i.ogmiosParameters.plutusCostModels['plutus:v1'][3];
  delete i.blockfrostParameters.cost_models_raw.PlutusV1[3];
  assert.throws(()=>createCardanoPreprodLiveProtocolSnapshot(i),/Incomplete or invalid/);
});


test('reference-script base price 15 is compared as a price, not a voting fraction',()=>{
  const i=inputs();i.ogmiosParameters.minFeeReferenceScripts={range:25600,multiplier:'12/10',base:'30/2'};
  const snapshot=createCardanoPreprodLiveProtocolSnapshot(i);
  assert.ok(snapshot.confirmedAdditionalFields.includes('min_fee_ref_script_cost_per_byte'));
  const {context}=createScalusCapturedProtocolContext(snapshot,api());
  assert.deepEqual(context.referenceScriptFeeSchedule.base,{numerator:'15',denominator:'1'});
  assert.equal(context.additionalFieldsIndependentlyConfirmed,true);
  assert.equal(context.completeCurrentProtocolContext,false);
});
test('reference-script comparison rejects absent, conflicting and unsupported tier inputs',()=>{
  for(const mutate of [
    i=>i.blockfrostParameters.min_fee_ref_script_cost_per_byte=16,
    i=>delete i.ogmiosParameters.minFeeReferenceScripts,
    i=>delete i.blockfrostParameters.min_fee_ref_script_cost_per_byte,
    i=>i.ogmiosParameters.minFeeReferenceScripts.range=25601,
    i=>i.ogmiosParameters.minFeeReferenceScripts.multiplier='5/4',
    i=>delete i.ogmiosParameters.minFeeReferenceScripts.base,
    i=>i.ogmiosParameters.minFeeReferenceScripts.multiplier='6/0',
    i=>i.ogmiosParameters.minFeeReferenceScripts.range=Number.MAX_SAFE_INTEGER+1
  ]) {
    const i=inputs();mutate(i);
    assert.throws(()=>createCardanoPreprodLiveProtocolSnapshot(i),/minFeeRefScriptCostPerByte/);
  }
});
test('replay cannot trust rewritten fee schedule claims or silently truncate a fractional fee',()=>{
  const s=structuredClone(createCardanoPreprodLiveProtocolSnapshot(inputs()));
  s.capturedOgmiosParameters.minFeeReferenceScripts.multiplier='2/1';
  assert.throws(()=>createScalusCapturedProtocolContext(s,api()),/minFeeRefScriptCostPerByte/);
  const i=inputs();i.blockfrostParameters.min_fee_ref_script_cost_per_byte=15.5;
  i.ogmiosParameters.minFeeReferenceScripts.base='31/2';
  const fractional=createCardanoPreprodLiveProtocolSnapshot(i);
  assert.throws(()=>createScalusCapturedProtocolContext(fractional,api()),/Scalus exact integer interface/);
});
test('engine security-threshold alias cannot override independently confirmed canonical value',()=>{
  const s=structuredClone(createCardanoPreprodLiveProtocolSnapshot(inputs()));
  s.capturedBlockfrostParameters.pvtpp_security_group=0.25;
  assert.equal(createScalusCapturedProtocolContext(s,api()).context.additionalFieldsIndependentlyConfirmed,true);
  s.capturedBlockfrostParameters.pvtpp_security_group=0.9;
  assert.throws(()=>createScalusCapturedProtocolContext(s,api()),/aliases disagree/);
});
test('missing historical Ogmios capture remains explicitly unconfirmed',()=>{
  const s=structuredClone(createCardanoPreprodLiveProtocolSnapshot(inputs()));
  delete s.capturedOgmiosParameters;
  const {context}=createScalusCapturedProtocolContext(s,api());
  assert.equal(context.additionalFieldsIndependentlyConfirmed,false);
  assert.ok(context.unconfirmedFields.includes('dvt_p_p_gov_group'));
  assert.equal(context.referenceScriptFeeSchedule,null);
});


test('shared snapshot parser rejects contradictory captures before any construction or replay',()=>{
  for(const mutate of [
    s=>s.capturedBlockfrostParameters.gov_action_deposit='1',
    s=>s.capturedOgmiosParameters.delegateRepresentativeVotingThresholds.noConfidence='1/10',
    s=>s.capturedBlockfrostParameters.cost_models_raw.PlutusV2[331]++,
    s=>s.capturedOgmiosParameters.minFeeReferenceScripts.range=12345,
    s=>delete s.capturedBlockfrostParameters
  ]) {
    const s=structuredClone(createCardanoPreprodLiveProtocolSnapshot(inputs()));
    mutate(s);
    assert.throws(()=>normalizeCardanoProtocolParameterSnapshot(s));
  }
  assert.equal(normalizeCardanoProtocolParameterSnapshot(createCardanoPreprodLiveProtocolSnapshot(inputs())).minFeeA,44n);
});
