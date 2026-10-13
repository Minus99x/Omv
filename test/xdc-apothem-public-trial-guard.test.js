import test from 'node:test';
import assert from 'node:assert/strict';
import {
  XDC_PUBLIC_TRIAL_NETWORK,XDC_PUBLIC_TRIAL_FEE_LIMIT_WEI,
  XDC_PUBLIC_TRIAL_DEPOSIT_WEI,validateApothemTrialRoles,
  requirePublicApothemChainId,boundedApothemFee,verifyApothemReceipt,
  verifyApothemRuntimeBytecode
} from '../src/chains/evm/apothem-public-trial-guard.js';
const roles={owner:'0x'+'11'.repeat(20),guardianA:'0x'+'22'.repeat(20),
guardianB:'0x'+'33'.repeat(20),rescue:'0x'+'44'.repeat(20)};
test('fixed testnet identity refuses mainnet and wrong chain',()=>{
 assert.equal(XDC_PUBLIC_TRIAL_NETWORK.chainId,51);
 assert.equal(requirePublicApothemChainId('0x33'),51);
 for(const v of ['0x32','0x01',1,50,52,null,'bogus']){
  assert.throws(()=>requirePublicApothemChainId(v),/invalid|limited/);
 }
});
test('only unique nonzero disposable owner, guardians and rescue can run',()=>{
 assert.equal(validateApothemTrialRoles(roles).guardianB,roles.guardianB);
 for(const v of [{...roles,rescue:roles.owner},{...roles,guardianA:roles.guardianB},
 {...roles,owner:'xdc'+'11'.repeat(20)},{...roles,rescue:'0x'+'00'.repeat(20)},{...roles,guardianB:null}]){
  assert.throws(()=>validateApothemTrialRoles(v),/distinct|Invalid/);
 }
});
test('five-fake-TXDC ceiling is cumulative and overestimated gas is rejected',()=>{
 assert.equal(XDC_PUBLIC_TRIAL_DEPOSIT_WEI,100000000000000000n);
 const fee=boundedApothemFee({estimatedGas:1442885n,gasPriceWei:625000000000n});
 assert.ok(fee.maxFee>1000000000000000000n&&fee.maxFee<XDC_PUBLIC_TRIAL_FEE_LIMIT_WEI);
 assert.ok(fee.gasLimit>=1442885n);
 assert.throws(()=>boundedApothemFee({estimatedGas:1442885n,gasPriceWei:625000000000n,spentFeeWei:4n*10n**18n}),/ceiling/);
 for(const props of [{estimatedGas:0n,gasPriceWei:1n},{estimatedGas:4000000n,gasPriceWei:1n},
 {estimatedGas:25000n,gasPriceWei:1000000000001n},{estimatedGas:25000n,gasPriceWei:625000000000n,capWei:6n*10n**18n}]){
  assert.throws(()=>boundedApothemFee(props),/bounds|five/);
 }
});
test('receipt must match included transaction and actual gas fee',()=>{
 const hash='0x'+'ab'.repeat(32),receipt={hash,blockHash:'0x'+'cd'.repeat(32),
 blockNumber:500,status:1,gasUsed:40000n,gasPrice:625000000000n,contractAddress:roles.owner};
 const out=verifyApothemReceipt({receipt,transactionHash:hash,expectedContract:roles.owner});
 assert.equal(out.actualFeeWei,'25000000000000000');
 for(const bad of [{...receipt,status:0},{...receipt,hash:'0x'+'cc'.repeat(32)},
 {...receipt,blockHash:'0x0'},{...receipt,gasUsed:0n}]){
  assert.throws(()=>verifyApothemReceipt({receipt:bad,transactionHash:hash}),/Receipt/);
 }
 assert.throws(()=>verifyApothemReceipt({receipt,transactionHash:hash,expectedContract:roles.rescue}),/mismatch/);
});
test('compiled runtime comparison masks only the exact compiler-declared immutable slots',()=>{
 const expected='0x6000aa5500ff';
 const actual='0x6000bb5500ff';
 const verified=verifyApothemRuntimeBytecode({
  compiledRuntime:expected,actualRuntime:actual,
  immutableReferences:{'1':[{start:2,length:1}]}
 });
 assert.equal(verified.matched,true);
 assert.equal(verified.immutableBytes,1);
 assert.throws(()=>verifyApothemRuntimeBytecode({compiledRuntime:expected,actualRuntime:actual}),/differs/);
 assert.throws(()=>verifyApothemRuntimeBytecode({compiledRuntime:expected,actualRuntime:'0x6000bb5500'}),/size/);
 assert.throws(()=>verifyApothemRuntimeBytecode({compiledRuntime:expected,actualRuntime:actual,
  immutableReferences:{'1':[{start:8,length:2}]}}),/outside/);
});
