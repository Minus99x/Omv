import test from 'node:test';
import assert from 'node:assert/strict';
import {defineFinalityPolicy,createFinalityObservation,DEFAULT_FINALITY_POLICIES}
 from '../src/chains/finality.js';
const policy=()=>({chainId:'bitcoin',networkRef:'bitcoin:signet',model:'confirmations',
 target:{confirmations:6},evidenceFields:['blockHash','height','confirmations']});
const obs=()=>({policy:DEFAULT_FINALITY_POLICIES.bitcoinSignet,
 transactionRef:'abc',observedAt:'2026-10-24T06:00:00Z',
 status:'included',evidence:{height:300000}});
test('finality policies prohibit coerced chain identity',()=>{
 for(const chainId of [true,{},[],null,''])
  assert.throws(()=>defineFinalityPolicy({...policy(),chainId}),/requires chainId/);
});
test('finality policies reject string arrays and malformed field entries',()=>{
 for(const field of ['evidenceFields','notes'])
  for(const value of ['hello',42,{length:1}])
   assert.throws(()=>defineFinalityPolicy({...policy(),[field]:value}),/must be an array/);
 for(const field of ['evidenceFields','notes'])
  assert.throws(()=>defineFinalityPolicy({...policy(),[field]:[{}]}),/primitive text/);
});
test('finality policy cannot include duplicate required evidence entries',()=>{
 assert.throws(()=>defineFinalityPolicy({...policy(),evidenceFields:['height','height']}),/repeat/);
});
test('finality observation rejects unknown models and coerced transaction identity',()=>{
 for(const transactionRef of [true,{},''])
  assert.throws(()=>createFinalityObservation({...obs(),transactionRef}),/requires policy/);
 assert.throws(()=>createFinalityObservation({...obs(),policy:{...policy(),model:'unknown'}}),/requires policy/);
});
test('finality observation timestamp must be a real UTC calendar date',()=>{
 for(const observedAt of ['2026-02-30T05:00:00Z','2026-10-24T05:00:00',
 '2026-10-24','2026-10-24T24:00:00Z','2026-13-24T05:00:00Z'])
  assert.throws(()=>createFinalityObservation({...obs(),observedAt}),/unambiguous real UTC/);
 assert.equal(createFinalityObservation(obs()).status,'included');
});
test('finality observations require structured evidence',()=>{
 for(const evidence of [[],42,'pass',null])
  assert.throws(()=>createFinalityObservation({...obs(),evidence}),/evidence must be an object/);
});
