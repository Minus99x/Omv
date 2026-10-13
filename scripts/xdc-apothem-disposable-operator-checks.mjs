import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet} from 'ethers';
import {createEncryptedDisposableBundle,validateDisposablePublicManifest,
 inspectDisposableFunding} from './xdc-apothem-disposable-wallet.js';
import {requireLiveTrialGate,executeDisposableApothemTrial} from './xdc-apothem-disposable-live.js';
const pass='local-fixture-password-not-for-real-wallets';
test('disposable private keys are encrypted, four roles distinct and never returned as naked secrets',async()=>{
 const bundle=await createEncryptedDisposableBundle({password:pass});
 const roles=validateDisposablePublicManifest(bundle.publicManifest).roles;
 assert.equal(new Set(Object.values(roles)).size,4);
 assert.equal(bundle.secrets.chainId,51);
 const saved=JSON.stringify(bundle.secrets);
 for(const role of Object.keys(roles)){
  const decrypted=await Wallet.fromEncryptedJson(bundle.secrets.encrypted[role],pass);
  assert.equal(decrypted.address.toLowerCase(),roles[role]);
  assert.equal(saved.toLowerCase().includes(decrypted.privateKey.slice(2).toLowerCase()),false);
 }
 assert.equal(saved.includes(pass),false);
 assert.throws(()=>validateDisposablePublicManifest({...bundle.publicManifest,chainId:50}),/strict chain 51/);
 assert.throws(()=>validateDisposablePublicManifest({...bundle.publicManifest,mainnetAllowed:true}),/strict chain 51/);
});
test('short passphrases and duplicate EVM roles fail before returning wallet bundle',async()=>{
 await assert.rejects(createEncryptedDisposableBundle({password:'short'}),/12 to 256/);
 const wallet=Wallet.createRandom();
 await assert.rejects(createEncryptedDisposableBundle({password:pass,walletFactory:()=>wallet}),/distinct/);
});
function rpcFixture({wrongChain=false,rescueCode='0x',balance='0x29a2241af62c0000'}={}){
 const calls=[];
 const fetch=async (url,options)=>{
  const request=JSON.parse(options.body);calls.push({url,request});
  const value=request.method==='eth_chainId'?(wrongChain?'0x32':'0x33'):
   request.method==='eth_getCode'?rescueCode:balance;
  return {ok:true,async json(){return {jsonrpc:'2.0',id:request.id,result:value};}};
 };
 return {fetch,calls};
}
test('funding readiness needs 2 chain-51 RPCs, funded owner and code-free rescue',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'omv-xdc-funding-test-'));
 try{
  const bundle=await createEncryptedDisposableBundle({password:pass});
  writeFileSync(join(temp,'public.json'),JSON.stringify(bundle.publicManifest));
  const good=rpcFixture();
  const report=await inspectDisposableFunding({directory:temp,fetchImpl:good.fetch});
  assert.equal(report.network,'xdc:apothem');
  assert.equal(report.fundingVerified,true);
  assert.equal(report.rescueHasNoCodeOnBothProviders,true);
  assert.equal(report.privateKeysAccessed,false);
  assert.equal(report.transactionSubmitted,false);
  assert.equal(good.calls.length,8);
  assert.equal(good.calls.every(c=>['eth_chainId','eth_getBalance','eth_getCode'].includes(c.request.method)),true);
  await assert.rejects(inspectDisposableFunding({directory:temp,fetchImpl:rpcFixture({wrongChain:true}).fetch}),/limited/);
  await assert.rejects(inspectDisposableFunding({directory:temp,fetchImpl:rpcFixture({rescueCode:'0x6000'}).fetch}),/EOA/);
  const short=await inspectDisposableFunding({directory:temp,fetchImpl:rpcFixture({balance:'0x1'}).fetch});
  assert.equal(short.fundingVerified,false);
 }finally{rmSync(temp,{force:true,recursive:true});}
});
test('live trial remains disabled unless operator supplies exact opt-in',async()=>{
 for(const env of [{},{OMEGAVAULT_XDC_APOTHEM_DISPOSABLE_LIVE:'TRUE'},
  {OMEGAVAULT_XDC_APOTHEM_DISPOSABLE_LIVE:'PUBLIC_MAINNET_TX_ONLY'}]){
  assert.throws(()=>requireLiveTrialGate(env),/OFF/);
  await assert.rejects(executeDisposableApothemTrial({env}),/OFF/);
 }
 assert.equal(requireLiveTrialGate({
  OMEGAVAULT_XDC_APOTHEM_DISPOSABLE_LIVE:'PUBLIC_APOTHEM_FAKE_TXDC_ONLY'
 }),true);
});
