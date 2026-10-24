import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requirePublicApothemChainId, boundedApothemFee,
  verifyApothemReceipt, verifyApothemRuntimeBytecode
} from '../src/chains/evm/apothem-public-trial-guard.js';

const hash='0x'+'ab'.repeat(32), contract='0x'+'11'.repeat(20);
const receipt=()=>({hash,blockHash:'0x'+'cd'.repeat(32),
  blockNumber:500,status:1,gasUsed:40000n,gasPrice:625000000000n,contractAddress:contract});

test('EIP-1474 chain identity forbids accidental coercion and decimal aliases',()=>{
  assert.equal(requirePublicApothemChainId('0x33'),51);
  for(const invalid of [51,51n,'51','0x033',' 0x33 ',['0x33'],
    {valueOf(){return 51n;}},null,true,'0X33'])
    assert.throws(()=>requirePublicApothemChainId(invalid),/invalid|canonical/);
});
test('Apothem fee boundaries reject noncanonical integer coercion',()=>{
  for(const bad of [true,null,[],['25000'],{valueOf(){return 25000;}},'025000',
    25000.5,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>boundedApothemFee({estimatedGas:bad,gasPriceWei:1}),
      /exact non-negative primitive/);
  for(const bad of [true,[],['1'],'01',1.5,-1])
    assert.throws(()=>boundedApothemFee({estimatedGas:25000,gasPriceWei:bad}),
      /exact non-negative primitive/);
  assert.equal(boundedApothemFee({estimatedGas:'0x61a8',gasPriceWei:'0x1'}).gasLimit,31250n);
});
test('Apothem receipt status accepts only literal success, never coercion',()=>{
  for(const ok of [1,1n,'0x1'])
    assert.equal(verifyApothemReceipt({receipt:{...receipt(),status:ok},
      transactionHash:hash}).blockNumber,'500');
  for(const invalid of [true,'1','01',['1'],{valueOf(){return 1;}},null,0])
    assert.throws(()=>verifyApothemReceipt({receipt:{...receipt(),status:invalid},
      transactionHash:hash}),/included successful/);
});
test('Apothem receipt quantities and block identity are exact',()=>{
  for(const field of ['blockNumber','gasUsed','gasPrice'])
    for(const invalid of [true,[],['1'],'01',{},1.2,Number.MAX_SAFE_INTEGER+1])
      assert.throws(()=>verifyApothemReceipt({receipt:{...receipt(),[field]:invalid},
        transactionHash:hash}),/Receipt/);
  assert.throws(()=>verifyApothemReceipt({receipt:{...receipt(),blockHash:{}},
    transactionHash:hash}),/canonical block identity/);
  assert.throws(()=>verifyApothemReceipt({receipt:{...receipt(),
    hash:{toString(){return hash;}}},transactionHash:hash}),/hash mismatch/);
  assert.equal(verifyApothemReceipt({receipt:{...receipt(),blockNumber:'0x1f4',
    gasUsed:'0x9c40',gasPrice:'0x9184e72a00'},transactionHash:hash}).actualFeeWei,
    '25000000000000000');
});
test('Runtime immutable offsets require compiler integer types and nonoverlap',()=>{
  const original='0x6000aa5500ff',actual='0x6000bb5500ff';
  assert.equal(verifyApothemRuntimeBytecode({compiledRuntime:original,actualRuntime:actual,
    immutableReferences:{'1':[{start:2,length:1}]}}).matched,true);
  for(const slot of [{start:'2',length:1},{start:true,length:1},
    {start:2,length:'1'},{start:2,length:1.5}])
    assert.throws(()=>verifyApothemRuntimeBytecode({compiledRuntime:original,actualRuntime:actual,
      immutableReferences:{'1':[slot]}}),/outside/);
  assert.throws(()=>verifyApothemRuntimeBytecode({compiledRuntime:original,actualRuntime:actual,
    immutableReferences:{'1':[{start:2,length:1}],'2':[{start:2,length:1}]}}),/Overlapping/);
  for(const bytecode of ['0xabc','0x','0x6000c'])
    assert.throws(()=>verifyApothemRuntimeBytecode({compiledRuntime:original,
      actualRuntime:bytecode}),/canonical|size/);
});
