import test from 'node:test';
import assert from 'node:assert/strict';
import {PROMOTION_GATES,createMaturityRecord,canPromoteToLiveProof,
 missingPromotionGates} from '../src/chains/maturity.js';
const all=()=>Object.fromEntries(PROMOTION_GATES.map(g=>[g,true]));
test('full promotion record passes only for explicit own boolean gate proofs',()=>{
 const r=createMaturityRecord({chainId:'stellar',stage:'offline-verified',gates:all()});
 assert.equal(r.completed,PROMOTION_GATES.length);
 assert.equal(canPromoteToLiveProof(r),true);
});
test('prototype inherited gate values cannot satisfy a promotion',()=>{
 const inherited=Object.create(all());
 const r=createMaturityRecord({chainId:'stellar',gates:inherited});
 assert.equal(r.completed,0);
 assert.equal(canPromoteToLiveProof(r),false);
 const forged={chainId:'stellar',stage:'scaffold',gates:inherited};
 assert.equal(canPromoteToLiveProof(forged),false);
 assert.equal(missingPromotionGates(forged).length,PROMOTION_GATES.length);
});
test('detached objects with all true gates still require a valid record identity and stage',()=>{
 for(const bad of [{gates:all()}, {chainId:[],stage:'scaffold',gates:all()},
   {chainId:'stellar',stage:'fiction',gates:all()},
   {chainId:'stellar',stage:'scaffold',gates:[]}])
   assert.equal(canPromoteToLiveProof(bad),false);
});
test('maturity creator rejects coerced chain and malformed stage metadata',()=>{
 for(const chainId of [[],{},true,0,''])
   assert.throws(()=>createMaturityRecord({chainId}),/chainId/);
 assert.throws(()=>createMaturityRecord({chainId:'stellar',stage:'fake'}),/stage/);
 for(const gates of [null,[],true])
   assert.throws(()=>createMaturityRecord({chainId:'stellar',gates}),/gates/);
});
