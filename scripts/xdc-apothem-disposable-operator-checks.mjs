import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet,Transaction} from 'ethers';
import {createEncryptedDisposableBundle,validateDisposablePublicManifest,
 inspectDisposableFunding,requirePrivateDirectoryOutsideGit} from './xdc-apothem-disposable-wallet.js';
import {requireLiveTrialGate,executeDisposableApothemTrial,broadcastSignedApothemTransaction} from './xdc-apothem-disposable-live.js';
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

test('preparation forbids plaintext and encrypted test wallet artifacts within any Git worktree',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'omv-xdc-worktree-test-'));
 try{
  mkdirSync(join(tmp,'.git'));
  const child=join(tmp,'subdir','private');
  assert.throws(()=>requirePrivateDirectoryOutsideGit(child),/cannot be saved inside a Git repository/);
  const outside=mkdtempSync(join(tmpdir(),'omv-xdc-private-test-'));
  try{assert.equal(requirePrivateDirectoryOutsideGit(outside),outside);}
  finally{rmSync(outside,{recursive:true,force:true});}
 }finally{rmSync(tmp,{recursive:true,force:true});}
});

test('signed Apothem hash is durably recorded before RPC broadcast or lost response',async()=>{
 const wallet=Wallet.createRandom();
 const tx={chainId:51,type:0,nonce:7,gasPrice:625000000000n,
  gasLimit:25000n,to:Wallet.createRandom().address,value:137n};
 const signer={
  getAddress:async()=>wallet.address,
  populateTransaction:async x=>({...x,from:wallet.address}),
  signTransaction:async x=>wallet.signTransaction(x)
 };
 let recorded=null,broadcasts=0;
 const response=await broadcastSignedApothemTransaction({
  signer,transaction:tx,
  recordBeforeBroadcast:async value=>{recorded=value;},
  network:{broadcastTransaction:async raw=>{
   broadcasts++;
   const signed=Transaction.from(raw);
   assert.equal(recorded.txHash,signed.hash);
   assert.equal(recorded.nonce,7);
   assert.equal(signed.from.toLowerCase(),wallet.address.toLowerCase());
   return {hash:signed.hash};
  }}
 });
 assert.equal(response.hash,recorded.txHash);
 assert.equal(broadcasts,1);
 let lostHash=null;
 await assert.rejects(broadcastSignedApothemTransaction({
  signer,transaction:tx,
  recordBeforeBroadcast:async value=>{lostHash=value.txHash;},
  network:{broadcastTransaction:async raw=>{
   assert.equal(Transaction.from(raw).hash,lostHash);
   throw Error('Public RPC response lost AFTER acceptance');
  }}
 }),/response lost/);
 assert.match(lostHash,/^0x[0-9a-f]{64}$/);
});
test('Apothem signed transaction mismatches and missing journal durability block broadcast',async()=>{
 const wallet=Wallet.createRandom();
 const tx={chainId:51,type:0,nonce:0,gasPrice:625000000000n,
  gasLimit:25000n,to:Wallet.createRandom().address,value:0n};
 const signer={
  getAddress:async()=>wallet.address,
  populateTransaction:async x=>({...x,from:wallet.address}),
  signTransaction:async x=>wallet.signTransaction(x)
 };
 let broadcastCount=0;
 const network={broadcastTransaction:async()=>{broadcastCount++;throw Error('unexpected broadcast');}};
 const recordBeforeBroadcast=async()=>{throw Error('journal write failed');};
 await assert.rejects(broadcastSignedApothemTransaction({
  signer,network,transaction:tx,recordBeforeBroadcast
 }),/journal write failed/);
 await assert.rejects(broadcastSignedApothemTransaction({
  signer:{...signer,signTransaction:async x=>wallet.signTransaction({...x,chainId:50})},
  network,transaction:tx,recordBeforeBroadcast:async()=>{throw Error('must not reach journal');}
 }),/differs from bounded chain-51 intent/);
 await assert.rejects(broadcastSignedApothemTransaction({
  signer,network,transaction:tx
 }),/durable pre-broadcast journal/);
 assert.equal(broadcastCount,0);
});
