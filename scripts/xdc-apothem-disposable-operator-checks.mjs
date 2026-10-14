import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet,Transaction} from 'ethers';
import {createEncryptedDisposableBundle,validateDisposablePublicManifest,
 inspectDisposableFunding,requirePrivateDirectoryOutsideGit} from './xdc-apothem-disposable-wallet.js';
import {requireLiveTrialGate,executeDisposableApothemTrial,broadcastSignedApothemTransaction,verifyPrematureGuardianAtHeartbeat,reconcileApothemPublicTrialReceipts} from './xdc-apothem-disposable-live.js';
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

test('premature guardian rejection is pinned to heartbeat inclusion block, not drifting latest',async()=>{
 const guardian={role:'guardianA'};
 const historicalBlock=812345;
 const heartbeatBlockHash='0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
 const observed=[];
 const vault={connect:role=>{
  assert.equal(role,guardian);
  return {approveRecovery:{staticCall:async overrides=>{
   observed.push(overrides);
   assert.deepEqual(overrides,{blockTag:historicalBlock});
   const error=new Error('execution reverted: InactivityNotElapsed');
   error.code='CALL_EXCEPTION';
   throw error;
  }}};
 }};
 const result=await verifyPrematureGuardianAtHeartbeat({
  network:{getBlock:async n=>{
   assert.equal(n,historicalBlock);
   return {timestamp:987654,hash:heartbeatBlockHash};
  }},
  vault,guardian,heartbeatReceipt:{blockNumber:historicalBlock,blockHash:heartbeatBlockHash},anchor:987654n
 });
 assert.equal(result.rejected,true);
 assert.equal(result.historicalBlockCall,true);
 assert.equal(result.blockNumber,String(historicalBlock));
 assert.equal(result.blockHash,heartbeatBlockHash);
 assert.equal(result.heartbeatTimestamp,'987654');
 assert.equal(observed.length,1);
});
test('premature guardian proof fails closed on heartbeat block mismatch or unexpected approval',async()=>{
 const hash='0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',otherHash='0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
 let calls=0;
 const guardian={role:'guardianA'};
 const vault={connect:()=>({approveRecovery:{staticCall:async()=>{calls++;return true;}}})};
 await assert.rejects(verifyPrematureGuardianAtHeartbeat({
  network:{getBlock:async()=>({timestamp:5001,hash})},
  vault,guardian,heartbeatReceipt:{blockNumber:55,blockHash:hash},anchor:5000n
 }),/anchor does not match/);
 assert.equal(calls,0);
 await assert.rejects(verifyPrematureGuardianAtHeartbeat({
  network:{getBlock:async()=>({timestamp:5000,hash})},
  vault,guardian,heartbeatReceipt:{blockNumber:55,blockHash:hash},anchor:5000n
 }),/unexpectedly succeeded/);
 assert.equal(calls,1);
 await assert.rejects(verifyPrematureGuardianAtHeartbeat({
  network:{getBlock:async()=>({timestamp:5000,hash:otherHash})},
  vault,guardian,heartbeatReceipt:{blockNumber:55,blockHash:hash},anchor:5000n
 }),/block hash differs from receipt/);
 assert.equal(calls,1);
 await assert.rejects(verifyPrematureGuardianAtHeartbeat({
  network:{getBlock:async()=>({timestamp:5000})},
  vault,guardian,heartbeatReceipt:{},anchor:5000n
 }),/inclusion block and block hash required/);
});

const xdcProofSequence=['deploy-v051','fund-guardian-a','fund-guardian-b','deposit-vault',
 'owner-heartbeat','guardian-a-approval','guardian-b-approval',
 'execute-two-guardian-recovery','late-native-post-recovery-deposit','sweep-late-native'];
function canonicalXdcFixture(){
 const contractAddress='0x'+'dd'.repeat(20);
 const receipts=xdcProofSequence.map((_,i)=>{
  const hash='0x'+(i+1).toString(16).padStart(2,'0').repeat(32);
  const blockHash='0x'+(i+21).toString(16).padStart(2,'0').repeat(32);
  return {hash,blockHash,blockNumber:9000+i,status:1,gasUsed:35000n,
   gasPrice:500000000000n,contractAddress:i===0?contractAddress:null};
 });
 const total=(receipts.reduce((sum,r)=>sum+r.gasUsed*r.gasPrice,0n)).toString();
 const journal={contractAddress,totalActualFeeWei:total,steps:receipts.map((r,i)=>({
  label:xdcProofSequence[i],status:'confirmed',txHash:r.hash,receipt:{
   txHash:r.hash,blockNumber:String(r.blockNumber),blockHash:r.blockHash,
   gasUsed:String(r.gasUsed),gasPriceWei:String(r.gasPrice),
   actualFeeWei:String(r.gasUsed*r.gasPrice),contractAddress:r.contractAddress
  }
 }))};
 const provider=()=>({
  send:async()=> '0x33',
  getTransactionReceipt:async hash=>receipts.find(r=>r.hash===hash)??null,
  getBlock:async blockNumber=>({
   hash:receipts.find(r=>r.blockNumber===blockNumber)?.blockHash
  })
 });
 return {journal,receipts,provider,total};
}
test('final XDC live evidence requires all ten canonical receipts matching two Apothem RPCs',async()=>{
 const fixture=canonicalXdcFixture();
 const proof=await reconcileApothemPublicTrialReceipts({
  journal:fixture.journal,primary:fixture.provider(),secondary:fixture.provider()
 });
 assert.equal(proof.transactionCount,10);
 assert.equal(proof.totalActualFeeWei,fixture.total);
 assert.equal(proof.bothProvidersReceiptsAndBlocksAgree,true);
 assert.equal(proof.independentXdposFinalityProven,false);
 assert.equal(proof.readOnly,true);
});
test('XDC receipt audit rejects altered receipt, missing tx, detached block and wrong chain',async()=>{
 const f=canonicalXdcFixture();
 const primary=f.provider(),secondary=f.provider();
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,secondary:{
   ...secondary,
   getTransactionReceipt:async hash=>{
    const original=await secondary.getTransactionReceipt(hash);
    return hash===f.receipts[2].hash?{...original,gasUsed:39000n}:original;
   }
  }
 }),/receipt mismatch/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,secondary:{
   ...secondary,
   getTransactionReceipt:async hash=>
    hash===f.receipts[4].hash?null:secondary.getTransactionReceipt(hash)
  }
 }),/Receipt/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,secondary:{
   ...secondary,
   getBlock:async n=>n===f.receipts[5].blockNumber?
    {hash:'0x'+'ff'.repeat(32)}:secondary.getBlock(n)
  }
 }),/no longer canonical/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,secondary:{...secondary,send:async()=> '0x32'}
 }),/chain ID 51/);
});
test('XDC receipt audit rejects incomplete journal and tampered aggregate fee',async()=>{
 const f=canonicalXdcFixture(),primary=f.provider(),secondary=f.provider();
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,steps:f.journal.steps.slice(1)},primary,secondary
 }),/ten-transaction/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,totalActualFeeWei:'1'},primary,secondary
 }),/cumulative fee total/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,steps:f.journal.steps.map((v,i)=>i===2?{...v,status:'submitted'}:v)},
  primary,secondary
 }),/missing expected confirmed step/);
});
