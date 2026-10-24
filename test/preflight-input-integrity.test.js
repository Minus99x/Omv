import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreflightResult,digestIntent} from '../src/chains/preflight.js';
const base={chainId:'stellar',networkRef:'stellar:testnet',
 operation:'recovery',transactionIntent:{to:'G-rescue',amount:'1'}};
test('preflight identifiers must be primitive nonblank strings',()=>{
 for(const field of ['chainId','networkRef','operation'])
  for(const bad of ['',{},[],true])
   assert.throws(()=>createPreflightResult({...base,[field]:bad}),/requires chainId/);
});
test('preflight rejects iterable strings instead of arrays',()=>{
 for(const field of ['requiredSigners','warnings','errors'])
  assert.throws(()=>createPreflightResult({...base,[field]:'claimed-proof'}),/must be arrays/);
});
test('preflight rejects nonprimitive signer and error contents',()=>{
 for(const field of ['requiredSigners','warnings','errors'])
  for(const bad of [true,{},[],''])
   assert.throws(()=>createPreflightResult({...base,[field]:[bad]}),/nonempty text/);
});
test('preflight cannot advertise readiness while any check fails',()=>{
 assert.throws(()=>createPreflightResult({...base,status:'ready',
   checks:{'wallet-proof':true,'block-proof':false}}),/Ready preflight/);
 assert.equal(createPreflightResult({...base,status:'ready',
   checks:{'wallet-proof':true}}).status,'ready');
});
test('preflight cannot report array or primitive checks as object matrix',()=>{
 for(const checks of [[],42,null,'pass'])
  assert.throws(()=>createPreflightResult({...base,checks}),/checks must be an object/);
});
test('preflight intent digest remains deterministic with ordered JSON object keys',()=>{
 assert.equal(digestIntent({a:1,b:2}),digestIntent({b:2,a:1}));
});
