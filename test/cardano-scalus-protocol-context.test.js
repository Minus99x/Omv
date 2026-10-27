import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createScalusCapturedProtocolContext} from '../src/chains/cardano/scalus-protocol-context.js';
import {hashCardanoEvidence} from '../src/chains/cardano/evidence-binding.js';
function snapshot() {
 const value=JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json',import.meta.url),'utf8'));
 value.parameters.maxValueSize=5000;
 return value;
}
function api() {
 return {ProtocolParams:{fromBlockfrostJson:JSON.parse},CardanoInfo:{preprod:()=>({
 protocolParams:{toBlockfrostJson:()=>JSON.stringify({key_deposit:'2000000',cost_models_raw:{PlutusV1:[1],PlutusV2:[2]}})},
 withProtocolParams: params=>({params})})}};
}
test('captured Scalus context maps exact parameters and discloses all bundled remainder',()=>{
 const s=snapshot(),original=JSON.stringify(s);
 const {cardanoInfo,context}=createScalusCapturedProtocolContext(s,api());
 const p=cardanoInfo.params;
 assert.equal(p.min_fee_a,44);assert.equal(p.min_fee_b,155381);
 assert.equal(p.max_tx_size,16384);assert.equal(p.max_val_size,5000);
 assert.equal(p.coins_per_utxo_size,'4310');assert.equal(p.price_mem,0.0577);assert.equal(p.price_step,0.0000721);
 assert.equal(p.max_tx_ex_mem,'17500000');assert.equal(p.max_tx_ex_steps,'10000000000');
 assert.equal(p.collateral_percent,150);assert.equal(p.max_collateral_inputs,3);
 assert.equal(p.protocol_major_ver,11);assert.equal(p.protocol_minor_ver,0);
 assert.deepEqual(p.cost_models_raw.PlutusV3,s.parameters.plutusV3CostModel);
 assert.deepEqual(context.bundledFields,['key_deposit','cost_models_raw.PlutusV1','cost_models_raw.PlutusV2']);
 assert.equal(context.snapshotSha256,hashCardanoEvidence(s));
 assert.equal(context.appliedParameterDocumentSha256,hashCardanoEvidence(p));
 assert.equal(context.completeCurrentProtocolContext,false);
 assert.equal(JSON.stringify(s),original);
});
test('captured Scalus context fails closed on unavailable API, incomplete parameters and inexact numbers',()=>{
 assert.throws(()=>createScalusCapturedProtocolContext(snapshot(),{CardanoInfo:{preprod:()=>({})}}),/unavailable/);
 const missing=snapshot();delete missing.parameters.maxValueSize;
 assert.throws(()=>createScalusCapturedProtocolContext(missing,api()),/maxValueSize/);
 const overflow=snapshot();overflow.parameters.minFeeA='9007199254740993';
 assert.throws(()=>createScalusCapturedProtocolContext(overflow,api()),/exact integer/);
 const ratio=snapshot();ratio.parameters.priceMemory={numerator:'1',denominator:'3'};
 assert.throws(()=>createScalusCapturedProtocolContext(ratio,api()),/round-trip exactly/);
 const model=snapshot();model.parameters.plutusV3CostModel[0]++;
 assert.throws(()=>createScalusCapturedProtocolContext(model,api()),/digest mismatch/);
});

function completeCapturedSnapshot() {
 const s=snapshot();
 const {cardanoInfo}=createScalusCapturedProtocolContext(s,api());
 s.capturedBlockfrostParameters={...cardanoInfo.params,epoch:s.parameters.epoch};
 return s;
}
test('complete provider document is passed to Scalus without bundled fallback',()=>{
 const s=completeCapturedSnapshot();s.capturedBlockfrostParameters.key_deposit='7654321';
 const {cardanoInfo,context}=createScalusCapturedProtocolContext(s,api());
 assert.equal(cardanoInfo.params.key_deposit,'7654321');
 assert.deepEqual(cardanoInfo.params,s.capturedBlockfrostParameters);
 assert.deepEqual(context.bundledFields,[]);
 assert.equal(context.mode,'captured-blockfrost-document');
 assert.equal(context.additionalFieldsIndependentlyConfirmed,false);
});
test('partial or conflicting provider capture fails instead of falling back to defaults',()=>{
 for(const mutate of [
  s=>delete s.capturedBlockfrostParameters.key_deposit,
  s=>s.capturedBlockfrostParameters.epoch++,
  s=>s.capturedBlockfrostParameters.min_fee_b++,
  s=>delete s.capturedBlockfrostParameters.cost_models_raw.PlutusV1,
  s=>delete s.capturedBlockfrostParameters.cost_models_raw.PlutusV3[0]
 ]) {
  const s=completeCapturedSnapshot();mutate(s);
  assert.throws(()=>createScalusCapturedProtocolContext(s,api()));
 }
});
