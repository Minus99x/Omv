import test from 'node:test';
import assert from 'node:assert/strict';
import {defineErc20Asset,erc20RecoveryAction}
 from '../src/chains/evm/erc20.js';
const owner='0x'+'11'.repeat(20),vault='0x'+'22'.repeat(20),token='0x'+'33'.repeat(20);
const asset={chainId:'ethereum',networkRef:'ethereum:sepolia',address:token};
const recovery={chainId:'ethereum',networkRef:'ethereum:sepolia',
 vaultContract:vault,tokenAddress:token,requiredSigner:owner};
test('ERC-20 token identity cannot resolve to EVM zero address',()=>{
 assert.throws(()=>defineErc20Asset({...asset,address:'0x'+'00'.repeat(20)}),/address is invalid/);
 assert.throws(()=>erc20RecoveryAction({...recovery,tokenAddress:'0x'+'00'.repeat(20)}),/token address is invalid/);
 assert.throws(()=>erc20RecoveryAction({...recovery,vaultContract:'0x'+'00'.repeat(20)}),/Vault contract/);
});
test('ERC-20 chain identity rejects caller object coercion',()=>{
 for(const chainId of [null,{},[],true,''])
  assert.throws(()=>defineErc20Asset({...asset,chainId}),/chain and network identity/);
});
test('ERC-20 metadata precision and token labels are exact',()=>{
 for(const decimals of [-1,1.5,256,'18',null?.decimals??'18'])
  assert.throws(()=>defineErc20Asset({...asset,decimals}),/decimals/);
 for(const symbol of [{toString(){return 'USDC'}},[],42,''])
  assert.throws(()=>defineErc20Asset({...asset,symbol}),/symbol/);
 assert.equal(defineErc20Asset({...asset,decimals:18,symbol:'TEST'}).decimals,18);
});
test('ERC-20 recovery signer and fee payer cannot be coerced',()=>{
 for(const requiredSigner of [null,{},[],true,'0x'+'0'.repeat(40)])
  assert.throws(()=>erc20RecoveryAction({...recovery,requiredSigner}),/requiredSigner/);
 for(const feePayer of [null,{},true,'0x'+'0'.repeat(40)])
  assert.throws(()=>erc20RecoveryAction({...recovery,feePayer}),/feePayer/);
 assert.equal(erc20RecoveryAction(recovery).feePayer,owner);
});
