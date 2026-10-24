import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapabilityMaturityContract}
 from '../src/chains/capability-contract.js';
const adapter={id:'stellar',name:'Stellar',implementationStage:'scaffold',capabilities:['balance-read']};
const network={id:'stellar:testnet',chainId:'stellar',name:'Stellar Testnet',
 environment:'testnet',implementationStage:'scaffold'};
const create=(props={})=>createCapabilityMaturityContract({adapter,
 networks:[network],...props});
test('capability contracts reject inherited promotion evidence',()=>{
 const inherited=Object.create({'network-profile':{passed:true,level:'source',refs:['claimed']}});
 const record=create({gateEvidence:inherited});
 assert.equal(record.gateEvidence['network-profile'].passed,false);
});
test('capability records reject malformed gate evidence shapes',()=>{
 for(const bad of [null,[],true])
  assert.throws(()=>create({gateEvidence:bad}),/gateEvidence/);
 for(const value of [null,[],true])
  assert.throws(()=>create({gateEvidence:{'network-profile':value}}),/Gate.*record object/);
});
test('capability contracts reject duplicate network identity',()=>{
 assert.throws(()=>create({networks:[network,{...network}]}),/repeat network IDs/);
});
test('capability contracts reject unknown promotion gates',()=>{
 assert.throws(()=>create({gateEvidence:{'fake-upstream':{passed:true,level:'public-testnet',refs:['unverified']}}}),/undeclared promotion gate/);
});
test('capability metadata requires duplicate-free primitive capabilities',()=>{
 for(const capabilities of ['balance-read',['balance-read','balance-read'],[{}],['']])
  assert.throws(()=>create({adapter:{...adapter,capabilities}}),/declaredCapabilities/);
});
test('ordinary offline-stage profiles remain valid and promotion-blocked',()=>{
 const result=create({gateEvidence:{'network-profile':{passed:true,level:'source',refs:['source-sha']}}});
 assert.equal(result.gateEvidence['network-profile'].passed,true);
 assert.equal(result.promotion.eligible,false);
});
