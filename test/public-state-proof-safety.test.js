import test from 'node:test';
import assert from 'node:assert/strict';
import { definePublicStateCheck,verifyPublicState,createStateSnapshot,
  compareIndependentStateSnapshots } from '../src/chains/public-state.js';

const base={chainId:'bitcoin',networkRef:'bitcoin:signet',mechanismRef:'recover',
  observedAt:'2026-10-24T05:00:00Z'};
const snap=(source,observations)=>createStateSnapshot({...base,source,observations});

test('public-state verification forbids prototype and empty identifiers',()=>{
 for(const id of ['__proto__','prototype','constructor','',null,{},[]])
  assert.throws(()=>definePublicStateCheck({id,description:'test',expected:true}),
    /requires id|reserved/);
});
test('missing required state cannot match a missing expected value',()=>{
 const check=definePublicStateCheck({id:'missing',description:'missing',expected:undefined});
 assert.equal(verifyPublicState({...base,source:'node',checks:[check],
   observations:{}}).verified,false);
});
test('duplicate checks and inherited state cannot attest recovery',()=>{
 const check=definePublicStateCheck({id:'txid',description:'inclusion',expected:'abc'});
 assert.throws(()=>verifyPublicState({...base,source:'node',checks:[check,check],
   observations:{txid:'abc'}}),/unique safe/);
 const observations=Object.create({txid:'abc'});
 assert.equal(verifyPublicState({...base,source:'node',checks:[check],observations}).verified,false);
});
test('provider comparisons reject matching missing fields',()=>{
 const compared=compareIndependentStateSnapshots(snap('rpc-1',{}),snap('rpc-2',{}),['txid']);
 assert.equal(compared.matches,false);
 assert.equal(compared.comparisons[0].matches,false);
});
test('provider comparisons reject inherited, unsafe and duplicate field names',()=>{
 const a=snap('rpc-A',{txid:'ab'}),b=snap('rpc-B',{txid:'ab'});
 assert.throws(()=>compareIndependentStateSnapshots(a,b,['txid','txid']),/distinct safe/);
 for(const field of ['__proto__','constructor','',null])
  assert.throws(()=>compareIndependentStateSnapshots(a,b,[field]),/distinct safe/);
});
test('two matching source labels do not constitute independent infrastructure proof',()=>{
 const compared=compareIndependentStateSnapshots(
   snap('rpc-A',{txid:'ab'}),snap('rpc-B',{txid:'ab'}),['txid']);
 assert.equal(compared.matches,true);
 assert.equal(compared.distinctSourceLabels,true);
 assert.equal(compared.independent,false);
});
