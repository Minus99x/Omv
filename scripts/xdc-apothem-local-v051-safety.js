#!/usr/bin/env node
/**
 * Isolated negative/positive proof for the NEW V0.5.1 candidate.
 * GANACHE ONLY: no public XDC, faucet, production keys, or wallet.
 * This does not overwrite the audited-input baseline V0.5 source.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, parseEther } from 'ethers';

const FILE='contracts/OmegaVaultRecoveryVaultV051.sol';
const NAME='OmegaVaultRecoveryVaultV051';
function compile(){
 const source=readFileSync(FILE,'utf8');
 if(!source.includes('contract '+NAME))throw Error('Unexpected V0.5.1 source');
 const input={language:'Solidity',sources:{[FILE]:{content:source}},settings:{
  optimizer:{enabled:true,runs:200},evmVersion:'paris',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}
 }};
 const version=execFileSync('npx',['--yes','solc@0.8.24','--version'],{encoding:'utf8',timeout:90000}).trim();
 if(!version.startsWith('0.8.24+'))throw Error('Solidity compiler mismatch');
 const output=execFileSync('npx',['--yes','solc@0.8.24','--standard-json'],{
  input:JSON.stringify(input),encoding:'utf8',timeout:120000,maxBuffer:5*1024*1024
 });
 const offset=output.indexOf('{');
 if(offset<0)throw Error('No compiler JSON');
 const result=JSON.parse(output.slice(offset));
 const failures=(result.errors??[]).filter(x=>x.severity==='error');
 if(failures.length)throw Error('V0.5.1 compiler errors: '+failures.map(x=>x.message).join('; '));
 const candidate=result.contracts?.[FILE]?.[NAME];
 if(!candidate?.evm?.bytecode?.object || !Array.isArray(candidate.abi))throw Error('Incorrect compiled contract');
 if(!candidate.abi.some(x=>x.name==='recoverLateNative'&&x.type==='function'))throw Error('Late-native recovery method not compiled');
 return {abi:candidate.abi,bytecode:'0x'+candidate.evm.bytecode.object,compiler:version};
}
async function mined(prom){
 const receipt=await (await prom).wait();
 if(receipt?.status!==1)throw Error('Expected mined successful transaction');
 return receipt;
}
export async function verifyLateNativeRecoveryLocally(){
 const compiled=compile();
 const local=ganache.provider({logging:{quiet:true},chain:{chainId:51,hardfork:'shanghai'},
  wallet:{deterministic:true,totalAccounts:6,defaultBalance:100},miner:{blockTime:0}});
 try{
  const provider=new BrowserProvider(local);
  const [owner,guardianA,guardianB,rescue,observer]=await Promise.all(
   [0,1,2,3,4].map(index=>provider.getSigner(index)));
  if((await provider.getNetwork()).chainId!==51n)throw Error('Not disposable chain 51');
  const [a,b,destination]=await Promise.all([
   guardianA.getAddress(),guardianB.getAddress(),rescue.getAddress()]);
  const vault=await new ContractFactory(compiled.abi,compiled.bytecode,owner)
   .deploy([a,b],2,45,destination);
  await vault.waitForDeployment();
  const contract=await vault.getAddress();
  assert.equal(await vault.ADAPTER_VERSION(),501n);
  await assert.rejects(()=>vault.recoverLateNative.staticCall(),/revert|CALL_EXCEPTION|execution/i);
  await mined(owner.sendTransaction({to:contract,value:parseEther('1')}));
  await local.request({method:'evm_increaseTime',params:[46]});
  await local.request({method:'evm_mine',params:[]});
  await mined(vault.connect(guardianA).approveRecovery());
  await mined(vault.connect(guardianB).approveRecovery());
  const rescueBefore=await provider.getBalance(destination);
  await mined(vault.connect(observer).executeRecovery());
  const rescueAfter=await provider.getBalance(destination);
  assert.equal(rescueAfter-rescueBefore,parseEther('1'));
  assert.equal(await vault.recovered(),true);
  await assert.rejects(()=>vault.executeRecovery.staticCall(),/revert|CALL_EXCEPTION|execution/i);
  const delayed=137n;
  await mined(owner.sendTransaction({to:contract,value:delayed}));
  assert.equal(await provider.getBalance(contract),delayed,'Late native funds reached a completed vault');
  const beforeSweep=await provider.getBalance(destination);
  await mined(vault.connect(observer).recoverLateNative());
  const afterSweep=await provider.getBalance(destination);
  assert.equal(afterSweep-beforeSweep,delayed,'Late funds must reach immutable rescue address');
  assert.equal(await provider.getBalance(contract),0n,'No native balance stranded');
  await mined(vault.connect(guardianB).recoverLateNative());
  assert.equal(await provider.getBalance(contract),0n);
  assert.equal(await provider.getBalance(destination),afterSweep,'Empty second sweep must not transfer value');
  return Object.freeze({
   schema:'omegavault.xdc.local-v051-late-native-proof.v1',
   network:'isolated Ganache chain 51 only',liveXdcNetworkUsed:false,
   compiler:compiled.compiler,contract:NAME,
   twoGuardianRecovery:true,earlySweepRejected:true,
   originalRescueAmountWei:parseEther('1').toString(),
   lateNativeAmountWei:delayed.toString(),
   lateNativePaidToImmutableRescue:true,emptySecondSweepSafe:true,
   localProofPassed:true,publicApothemProven:false,productionReady:false
  });
 }finally{await local.disconnect();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 verifyLateNativeRecoveryLocally().then(v=>console.log(JSON.stringify(v,null,2)))
 .catch(e=>{console.error('XDC_V051_LOCAL_SAFETY_BLOCKED:',String(e?.stack??e));process.exitCode=1;});
}
