#!/usr/bin/env node
/**
 * Isolated, disposable local EVM rehearsal of the EXACT V0.5 recovery source.
 * Ganache is an EVM simulator, NOT a deployed XDC node. No network access,
 * no user wallets/keys, no faucet or mainnet calls.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, parseEther } from 'ethers';
import { compileSource,readContract } from './xdc-apothem-deployment-preflight.js';

function mockTokenBuild(){
 const source=`// SPDX-License-Identifier: MIT
 pragma solidity ^0.8.24;
 contract DisposableMockXrc20 {
   mapping(address=>uint256) public balanceOf;
   constructor(address initialVault) { balanceOf[initialVault]=1000000; }
   function transfer(address recipient,uint256 amount) public returns(bool) {
     require(balanceOf[msg.sender]>=amount,"insufficient");
     balanceOf[msg.sender]-=amount; balanceOf[recipient]+=amount;return true;
   }
 }`;
 const file='DisposableMockXrc20.sol';
 const input={language:'Solidity',sources:{[file]:{content:source}},settings:{
   optimizer:{enabled:true,runs:200},evmVersion:'paris',
   outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}
 }};
 const raw=execFileSync('npx',['--yes','solc@0.8.24','--standard-json'],{
   input:JSON.stringify(input),encoding:'utf8',maxBuffer:5*1024*1024,timeout:120000
 });
 const start=raw.indexOf('{');
 if(start<0)throw Error('Mock token pinned compilation failed');
 const output=JSON.parse(raw.slice(start));
 if((output.errors??[]).some(x=>x.severity==='error'))throw Error('Mock token compiled with errors');
 const mock=output.contracts?.[file]?.DisposableMockXrc20;
 if(!mock?.evm?.bytecode?.object||!Array.isArray(mock.abi))throw Error('Mock token artifact missing');
 return mock;
}
async function expectRevert(call,label) {
 await assert.rejects(call, /revert|CALL_EXCEPTION|execution|missing revert data|estimateGas/i,label);
}
async function mined(promise){
 const tx=await promise;
 const receipt=await tx.wait();
 if(!receipt||receipt.status!==1)throw Error('Local EVM transaction did not succeed');
 return receipt;
}
export async function rehearseRecoveryLocally(){
 const compiled=compileSource(readContract()),mock=mockTokenBuild();
 const local=ganache.provider({
   logging:{quiet:true},
   chain:{chainId:51,hardfork:'shanghai'},
   wallet:{deterministic:true,totalAccounts:6,defaultBalance:100},
   miner:{blockTime:0}
 });
 try{
  const provider=new BrowserProvider(local);
  const [owner,contactA,contactB,rescue,observer]=await Promise.all(
   [0,1,2,3,4].map(i=>provider.getSigner(i)));
  const [ownerAddress,a,b,rescueAddress]=await Promise.all([
   owner.getAddress(),contactA.getAddress(),contactB.getAddress(),rescue.getAddress()
  ]);
  assert.equal((await provider.getNetwork()).chainId,51n);
  const vaultFactory=new ContractFactory(compiled.abi,'0x'+compiled.creation,owner);
  const vault=await vaultFactory.deploy([a,b],2,45,rescueAddress);
  await vault.waitForDeployment();
  const vaultAddress=await vault.getAddress();
  assert.equal((await vault.owner()).toLowerCase(),ownerAddress.toLowerCase());
  assert.equal((await vault.rescueDestination()).toLowerCase(),rescueAddress.toLowerCase());
  assert.equal(await vault.threshold(),2n);
  await mined(owner.sendTransaction({to:vaultAddress,value:parseEther('1')}));
  await expectRevert(()=>vault.connect(contactA).approveRecovery.staticCall(),'Guardian cannot approve before inactivity');
  await expectRevert(()=>vault.connect(observer).approveRecovery.staticCall(),'Noncontact cannot approve');
  await expectRevert(()=>vault.connect(observer).executeRecovery.staticCall(),'Recovery must not execute before inactivity');
  await mined(vault.heartbeat());
  await local.request({method:'evm_increaseTime',params:[46]});
  await local.request({method:'evm_mine',params:[]});
  await mined(vault.connect(contactA).approveRecovery());
  assert.equal(await vault.approvalCount(),1n);
  await expectRevert(()=>vault.executeRecovery.staticCall(),'One guardian cannot execute threshold 2');
  await mined(vault.connect(contactB).approveRecovery());
  assert.equal(await vault.approvalCount(),2n);
  const balanceBefore=BigInt(await local.request({method:'eth_getBalance',params:[rescueAddress,'latest']}));
  const recoveryReceipt=await mined(vault.connect(observer).executeRecovery());
  const balanceAfter=BigInt(await local.request({method:'eth_getBalance',params:[rescueAddress,'latest']}));
  assert.equal(balanceAfter-balanceBefore,parseEther('1'));
  assert.equal(await vault.recovered(),true);
  assert.equal(await provider.getBalance(vaultAddress),0n);
  await expectRevert(()=>vault.heartbeat.staticCall(),'Cannot heartbeat a recovered vault');
  await expectRevert(()=>vault.connect(contactB).approveRecovery.staticCall(),'Cannot approve again after recovery');
  await expectRevert(()=>vault.executeRecovery.staticCall(),'Cannot double recover');

  const tokenFactory=new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,owner);
  const token=await tokenFactory.deploy(vaultAddress);
  await token.waitForDeployment();
  const tokenAddress=await token.getAddress();
  assert.equal(await token.balanceOf(vaultAddress),1000000n);
  await mined(vault.connect(observer).recoverERC20(tokenAddress));
  assert.equal(await token.balanceOf(vaultAddress),0n);
  assert.equal(await token.balanceOf(rescueAddress),1000000n);

  const second=await vaultFactory.deploy([a,b],2,45,rescueAddress);
  await second.waitForDeployment();
  await local.request({method:'evm_increaseTime',params:[46]});
  await local.request({method:'evm_mine',params:[]});
  await mined(second.connect(contactA).approveRecovery());
  assert.equal(await second.approvalCount(),1n);
  await mined(second.heartbeat());
  assert.equal(await second.approvalCount(),0n);
  assert.equal(await second.approved(a),false);
  await expectRevert(()=>second.connect(contactB).approveRecovery.staticCall(),
   'Owner heartbeat resets inactivity and cancels prior guardian approval');

  return Object.freeze({
   schema:'omegavault.xdc.local-evm-rehearsal.v1',
   implementation:'OmegaVaultRecoveryVaultV050',
   chainId:51,
   network:'Ganache local EVM only',
   liveXdcNetworkUsed:false,
   deploymentSucceeded:true,
   ownerHeartbeatReset:true,
   prematureApprovalRejected:true,
   nonContactRejected:true,
   twoGuardianThresholdConfirmed:true,
   nativeRecoveryAmountWei:parseEther('1').toString(),
   recipientCreditedExactAmount:true,
   doubleRecoveryRejected:true,
   mockTokenRecoveredUnits:'1000000',
   tokenSweepVerified:true,
   recoveryGasUsed:recoveryReceipt.gasUsed.toString(),
   noProductionAssets:true
  });
 } finally {
  await local.disconnect();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 rehearseRecoveryLocally()
   .then(result=>console.log(JSON.stringify(result,null,2)))
   .catch(e=>{console.error('XDC_LOCAL_REHEARSAL_BLOCKED:',String(e?.stack??e));process.exitCode=1;});
}
