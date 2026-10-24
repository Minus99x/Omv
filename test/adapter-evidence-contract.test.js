import test from 'node:test';
import assert from 'node:assert/strict';
import {defineAdapter} from '../src/chains/adapter-interface.js';
const sample={
 id:'sample',family:'utxo',name:'Sample',accountModel:'account',
 transactionModel:'transaction',signingModel:'offline',
 recoveryMechanism:'threshold',implementationStage:'scaffold',
 validateAccount:()=>true,capabilities:['balance-read'],
 proofNetworks:['sample:testnet'],securityNotes:['Do not sign without owner consent.']
};
test('adapter accepts well-shaped, network-scoped read-only metadata',()=>{
 const result=defineAdapter(sample);
 assert.equal(result.id,'sample');
 assert.deepEqual(result.proofNetworks,['sample:testnet']);
 assert.equal(Object.isFrozen(result.proofNetworks),true);
});
test('adapter rejects empty core metadata strings',()=>{
 for(const field of ['id','family','name','accountModel','transactionModel','signingModel','recoveryMechanism','implementationStage'])
  assert.throws(()=>defineAdapter({...sample,[field]:'  '}),/required/);
});
test('adapter refuses string-iterable metadata masquerading as arrays',()=>{
 for(const field of ['proofNetworks','securityNotes'])
  assert.throws(()=>defineAdapter({...sample,[field]:'testnet'}),/must be an array/);
});
test('adapter metadata entries must be primitive nonempty text',()=>{
 for(const field of ['proofNetworks','securityNotes'])
  for(const entry of ['',null,true,{},['nested']])
   assert.throws(()=>defineAdapter({...sample,[field]:[entry]}),/non-empty string|network descriptor/);
});
test('proof network declarations never duplicate one target',()=>{
 assert.throws(()=>defineAdapter({...sample,proofNetworks:['sample:testnet','sample:testnet']}),/duplicate/);
});
