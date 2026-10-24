import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeeEvidence,reconcileFeeEvidence} from '../src/chains/fees.js';
const base={chainId:'stellar',networkRef:'stellar:testnet',
 feePayer:'G-owner',feeAsset:'XLM'};
const estimate=(props={})=>createFeeEvidence({...base,status:'estimate',total:'1000',...props});
const observed=(props={})=>createFeeEvidence({...base,status:'observed',
 total:'1000',transactionRef:'hash-A',...props});

test('fee evidence rejects coerced, noncanonical and unsafe integer values',()=>{
 for(const total of [[1000],{toString(){return '1000'}},
   Number.MAX_SAFE_INTEGER+1,'01000',true,1.5])
  assert.throws(()=>estimate({total}),/canonical non-negative/);
 for(const execution of [[42],{toString(){return '42'}},'042'])
  assert.throws(()=>estimate({components:{execution}}),/canonical non-negative/);
});
test('observed fees require primitive transaction identity',()=>{
 for(const transactionRef of [{toString(){return 'tx'}},[],true,'',null])
  assert.throws(()=>observed({transactionRef}),/transactionRef/);
});
test('fee components must be named objects and notes arrays',()=>{
 assert.throws(()=>estimate({components:[100]}),/components must be an object/);
 assert.throws(()=>estimate({notes:'a string'}),/notes must be an array/);
 for(const key of ['__proto__','prototype','constructor',''])
  assert.throws(()=>estimate({components:Object.fromEntries([[key,'1']])}),/nonreserved identifier/);
});
test('fee reconciliations never cross transaction identities',()=>{
 assert.throws(()=>reconcileFeeEvidence(estimate({transactionRef:'hash-B'}),
   observed()),/mismatch for transactionRef/);
 assert.equal(reconcileFeeEvidence(estimate({transactionRef:'hash-A'}),observed()).delta,'0');
});
test('fee reconciliation validates externally supplied totals independently',()=>{
 const e=estimate(),o=observed();
 for(const total of [['1'],Number.MAX_SAFE_INTEGER+1,'001'])
  assert.throws(()=>reconcileFeeEvidence({...e,total},o),/canonical non-negative/);
});
