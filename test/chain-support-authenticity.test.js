import test from 'node:test';
import assert from 'node:assert/strict';
import {CORE_INVARIANT_IDS} from '../src/core/invariants.js';
import {evaluateChainSupport} from '../src/chains/support-gates.js';
const contract=(extra={})=>({chainId:'stellar',
 promotion:{eligible:true,missingGates:[],insufficientEvidenceGates:[]},
 blockers:[],...extra});
const passed=()=>({chainId:'stellar',passed:true,level:'public-testnet',refs:['ledger-reference']});
const evidence=()=>Object.fromEntries(CORE_INVARIANT_IDS.map(id=>[id,passed()]));
test('support rejects missing and inherited invariant evidence',()=>{
 const inherited=Object.create(evidence());
 assert.equal(evaluateChainSupport({capabilityContract:contract(),invariantEvidence:inherited}).supported,false);
 assert.equal(evaluateChainSupport({capabilityContract:contract(),invariantEvidence:inherited}).insufficientInvariants.length,CORE_INVARIANT_IDS.length);
});
test('public-testnet evidence labels require well-formed distinct references',()=>{
 for(const refs of [['ok','ok'],['ok',{}],['ok',''],['ok',null]])
  assert.equal(evaluateChainSupport({capabilityContract:contract(),invariantEvidence:{
    ...evidence(),[CORE_INVARIANT_IDS[0]]:{...passed(),refs}
  }}).supported,false);
});
test('promotion eligibility cannot be forged without complete deficiency counts',()=>{
 const e=evidence();
 for(const promotion of [{eligible:true},{eligible:true,missingGates:[],insufficientEvidenceGates:['wallet-signing']},
   {eligible:true,missingGates:['threshold-semantics'],insufficientEvidenceGates:[]}])
  assert.equal(evaluateChainSupport({capabilityContract:contract({promotion}),invariantEvidence:e}).supported,false);
});
test('support requires chain-scoped testimony, not a coerced account value',()=>{
 const e=evidence();
 assert.equal(evaluateChainSupport({capabilityContract:contract({chainId:{toString(){return 'stellar'}}}),invariantEvidence:e}).supported,false);
});
test('all explicit evidence still requires established capability promotion',()=>{
 assert.equal(evaluateChainSupport({capabilityContract:contract(),invariantEvidence:evidence()}).supported,true);
 assert.throws(()=>evaluateChainSupport({capabilityContract:contract(),invariantEvidence:[]}),/record object/);
});
