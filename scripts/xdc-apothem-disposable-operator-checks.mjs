import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet,Transaction,Interface} from 'ethers';
import {createEncryptedDisposableBundle,validateDisposablePublicManifest,
 inspectDisposableFunding,requirePrivateDirectoryOutsideGit} from './xdc-apothem-disposable-wallet.js';
import {requireLiveTrialGate,executeDisposableApothemTrial,broadcastSignedApothemTransaction,verifyPrematureGuardianAtHeartbeat,reconcileApothemPublicTrialReceipts,requireExpectedVaultRevert,verifyApothemPayoutEvent,verifyApothemIncludedTransaction} from './xdc-apothem-disposable-live.js';
const pass='local-fixture-password-not-for-real-wallets';
const revertAbi=new Interface(['error InactivityNotElapsed()','error ThresholdNotMet()','error NotTrustedContact()']);
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

test('disposable wallet directory canonicalization blocks Git paths hidden by symlinks',()=>{
 const root=mkdtempSync(join(tmpdir(),'omv-xdc-symlink-check-'));
 try{
  const checkout=join(root,'repository');
  mkdirSync(checkout);
  // Linked worktrees use a .git file, not a .git directory.
  writeFileSync(join(checkout,'.git'),'gitdir: /unused-fixture-worktree');
  symlinkSync(checkout,join(root,'checkout-alias'),'dir');
  assert.throws(()=>requirePrivateDirectoryOutsideGit(join(root,'checkout-alias','uncreated','wallet')),
   /cannot be saved inside a Git repository/);
  const safe=join(root,'safe');
  mkdirSync(safe);
  symlinkSync(safe,join(root,'safe-alias'),'dir');
  assert.equal(requirePrivateDirectoryOutsideGit(join(root,'safe-alias','new','wallet')),
   join(safe,'new','wallet'));
 }finally{rmSync(root,{recursive:true,force:true});}
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

test('tampered signed nonce cannot be journaled or broadcast',async()=>{
 const wallet=Wallet.createRandom();
 const tx={chainId:51,type:0,nonce:7,gasPrice:625000000000n,
  gasLimit:25000n,to:Wallet.createRandom().address,value:0n};
 let journalWrites=0,broadcasts=0;
 const network={broadcastTransaction:async()=>{broadcasts++;throw Error('unexpected broadcast');}};
 const signer={
  getAddress:async()=>wallet.address,
  populateTransaction:async x=>({...x,from:wallet.address}),
  signTransaction:async x=>wallet.signTransaction({...x,nonce:8})
 };
 await assert.rejects(broadcastSignedApothemTransaction({
  signer,network,transaction:tx,recordBeforeBroadcast:async()=>{journalWrites++;}
 }),/differs from bounded chain-51 intent/);
 assert.equal(journalWrites,0);
 assert.equal(broadcasts,0);
});

test('populated nonce cannot silently override an explicit transaction nonce',async()=>{
 const wallet=Wallet.createRandom();
 const tx={chainId:51,type:0,nonce:7,gasPrice:625000000000n,
  gasLimit:25000n,to:Wallet.createRandom().address,value:0n};
 let journalWrites=0,broadcasts=0;
 const signer={
  getAddress:async()=>wallet.address,
  populateTransaction:async x=>({...x,from:wallet.address,nonce:8}),
  signTransaction:async x=>wallet.signTransaction(x)
 };
 await assert.rejects(broadcastSignedApothemTransaction({
  signer,transaction:tx,
  network:{broadcastTransaction:async()=>{broadcasts++;throw Error('unexpected broadcast');}},
  recordBeforeBroadcast:async()=>{journalWrites++;}
 }),/differs from bounded chain-51 intent/);
 assert.equal(journalWrites,0);
 assert.equal(broadcasts,0);
});

test('provider-populated nonce is preserved and journaled for unsigned nonce intent',async()=>{
 const wallet=Wallet.createRandom();
 const tx={chainId:51,type:0,gasPrice:625000000000n,
  gasLimit:25000n,to:Wallet.createRandom().address,value:0n};
 let recorded=null,broadcasts=0;
 const signer={
  getAddress:async()=>wallet.address,
  populateTransaction:async x=>({...x,from:wallet.address,nonce:3}),
  signTransaction:async x=>wallet.signTransaction(x)
 };
 const response=await broadcastSignedApothemTransaction({
  signer,transaction:tx,
  recordBeforeBroadcast:async x=>{recorded=x;},
  network:{broadcastTransaction:async raw=>{
   broadcasts++;
   const signed=Transaction.from(raw);
   assert.equal(signed.nonce,3);
   assert.equal(recorded.nonce,3);
   assert.equal(recorded.txHash,signed.hash);
   return {hash:signed.hash};
  }}
 });
 assert.equal(response.hash,recorded.txHash);
 assert.equal(broadcasts,1);
});

test('premature guardian rejection is pinned to heartbeat inclusion block, not drifting latest',async()=>{
 const guardian={role:'guardianA'};
 const historicalBlock=812345;
 const heartbeatBlockHash='0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
 const observed=[];
 const vault={interface:revertAbi,connect:role=>{
  assert.equal(role,guardian);
  return {approveRecovery:{staticCall:async overrides=>{
   observed.push(overrides);
   assert.deepEqual(overrides,{blockTag:historicalBlock});
   const error=new Error('execution reverted: InactivityNotElapsed');
   error.code='CALL_EXCEPTION';error.data=revertAbi.encodeErrorResult('InactivityNotElapsed',[]);
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
test('premature guardian proof fails closed if heartbeat block reorganizes DURING historical eth_call',async()=>{
 const hash='0x'+'a1'.repeat(32),reorgHash='0x'+'b2'.repeat(32);
 let blockReads=0,guardCalls=0;
 const network={getBlock:async()=>{
  blockReads++;
  return {timestamp:5000,hash:blockReads===1?hash:reorgHash};
 }};
 const guardian={role:'guardianA'};
 const vault={interface:revertAbi,connect:()=>({approveRecovery:{
  staticCall:async()=>{
   guardCalls++;
   const error=new Error('EVM reverted');
   error.code='CALL_EXCEPTION';
   error.data=revertAbi.encodeErrorResult('InactivityNotElapsed',[]);
   throw error;
  }
 }})};
 await assert.rejects(verifyPrematureGuardianAtHeartbeat({
  network,vault,guardian,heartbeatReceipt:{blockNumber:55,blockHash:hash},anchor:5000n
 }),/inclusion block changed during historical call/);
 assert.equal(blockReads,2);
 assert.equal(guardCalls,1);
});
test('premature guardian proof fails closed if anchor timestamp changes during historical eth_call',async()=>{
 const hash='0x'+'a1'.repeat(32);
 let blockReads=0;
 const network={getBlock:async()=>{
  blockReads++;
  return {hash,timestamp:blockReads===1?5000:5001};
 }};
 const vault={interface:revertAbi,connect:()=>({approveRecovery:{
  staticCall:async()=>{
   const error=new Error('EVM reverted');
   error.code='CALL_EXCEPTION';
   error.data=revertAbi.encodeErrorResult('InactivityNotElapsed',[]);
   throw error;
  }
 }})};
 await assert.rejects(verifyPrematureGuardianAtHeartbeat({
  network,vault,guardian:{},heartbeatReceipt:{blockNumber:55,blockHash:hash},anchor:5000n
 }),/inclusion block changed during historical call/);
 assert.equal(blockReads,2);
});
test('premature guardian proof fails closed on heartbeat block mismatch or unexpected approval',async()=>{
 const hash='0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',otherHash='0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
 let calls=0;
 const guardian={role:'guardianA'};
 const vault={interface:revertAbi,connect:()=>({approveRecovery:{staticCall:async()=>{calls++;return true;}}})};
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
 const rescue='0x'+'ee'.repeat(20);
 const owner='0x'+'11'.repeat(20),guardianA='0x'+'22'.repeat(20);
 const guardianB='0x'+'33'.repeat(20);
 const roles={owner,guardianA,guardianB,rescue};
 const eventInterface=new Interface([
  'function heartbeat()','function approveRecovery()',
  'function executeRecovery()','function recoverLateNative()',
  'event RecoveryExecuted(address indexed destination,uint256 nativeAmount)',
  'event LateNativeRecovered(address indexed destination,uint256 amount)'
 ]);
 const receipts=xdcProofSequence.map((_,i)=>{
  const hash='0x'+(i+1).toString(16).padStart(2,'0').repeat(32);
  const blockHash='0x'+(i+21).toString(16).padStart(2,'0').repeat(32);
  const eventName=i===7?'RecoveryExecuted':i===9?'LateNativeRecovered':null;
  const nativeAmount=i===7?100000000000000000n:137n;
  const encoded=eventName?eventInterface.encodeEventLog(eventInterface.getEvent(eventName),[rescue,nativeAmount]):null;
  return {hash,blockHash,blockNumber:9000+i,status:1,gasUsed:35000n,
   gasPrice:500000000000n,contractAddress:i===0?contractAddress:null,
   logs:encoded?[{address:contractAddress,topics:encoded.topics,data:encoded.data}]:[]};
 });
 const transactions=receipts.map((r,i)=>{
  const label=xdcProofSequence[i];
  const from=i===5?guardianA:i===6?guardianB:owner;
  const nonce=i<=4?i:i===5||i===6?0:i-2;
  const to=i===0?null:i===1?guardianA:i===2?guardianB:contractAddress;
  const value=i===1||i===2||i===3?100000000000000000n:i===8?137n:0n;
  const method=i===4?'heartbeat':i===5||i===6?'approveRecovery':
   i===7?'executeRecovery':i===9?'recoverLateNative':null;
  const data=i===0?'0x60006000':
   method?eventInterface.encodeFunctionData(method,[]):'0x';
  return {hash:r.hash,blockHash:r.blockHash,blockNumber:r.blockNumber,
   gasPrice:r.gasPrice,chainId:51n,type:0,nonce,from,to,value,data,label};
 });
 const total=(receipts.reduce((sum,r)=>sum+r.gasUsed*r.gasPrice,0n)).toString();
 const journal={contractAddress,roles,totalActualFeeWei:total,steps:receipts.map((r,i)=>({
  nonce:transactions[i].nonce,from:transactions[i].from,valueWei:transactions[i].value.toString(),
  label:xdcProofSequence[i],status:'confirmed',txHash:r.hash,receipt:{
   txHash:r.hash,blockNumber:String(r.blockNumber),blockHash:r.blockHash,
   gasUsed:String(r.gasUsed),gasPriceWei:String(r.gasPrice),
   actualFeeWei:String(r.gasUsed*r.gasPrice),contractAddress:r.contractAddress
  }
 }))};
 const provider=()=>({
  send:async()=> '0x33',
  getTransactionReceipt:async hash=>receipts.find(r=>r.hash===hash)??null,
  getTransaction:async hash=>transactions.find(t=>t.hash===hash)??null,
  getBlock:async blockNumber=>({
   hash:receipts.find(r=>r.blockNumber===blockNumber)?.blockHash
  })
 });
 return {journal,receipts,transactions,provider,total,eventInterface,contractAddress,rescue,roles};
}
test('final XDC live evidence requires all ten canonical receipts matching two Apothem RPCs',async()=>{
 const fixture=canonicalXdcFixture();
 const proof=await reconcileApothemPublicTrialReceipts({
  journal:fixture.journal,primary:fixture.provider(),secondary:fixture.provider(),
  contractInterface:fixture.eventInterface
 });
 assert.equal(proof.transactionCount,10);
 assert.equal(proof.totalActualFeeWei,fixture.total);
 assert.equal(proof.bothProvidersReceiptsAndBlocksAgree,true);
 assert.equal(proof.bothProvidersNativePayoutEventsVerified,true);
 assert.equal(proof.allTenSignedRoleIdentitiesAndNoncesVerified,true);
 assert.equal(proof.nativeRecoveryAmountWei,'100000000000000000');
 assert.equal(proof.lateNativeRecoveryAmountWei,'137');
 assert.equal(proof.independentXdposFinalityProven,false);
 assert.equal(proof.readOnly,true);
});
test('XDC receipt audit rejects altered receipt, missing tx, detached block and wrong chain',async()=>{
 const f=canonicalXdcFixture();
 const primary=f.provider(),secondary=f.provider();
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,contractInterface:f.eventInterface,secondary:{
   ...secondary,
   getTransactionReceipt:async hash=>{
    const original=await secondary.getTransactionReceipt(hash);
    return hash===f.receipts[2].hash?{...original,gasUsed:39000n}:original;
   }
  }
 }),/receipt mismatch/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,contractInterface:f.eventInterface,secondary:{
   ...secondary,
   getTransactionReceipt:async hash=>
    hash===f.receipts[4].hash?null:secondary.getTransactionReceipt(hash)
  }
 }),/Receipt/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,contractInterface:f.eventInterface,secondary:{
   ...secondary,
   getBlock:async n=>n===f.receipts[5].blockNumber?
    {hash:'0x'+'ff'.repeat(32)}:secondary.getBlock(n)
  }
 }),/no longer canonical/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,contractInterface:f.eventInterface,secondary:{...secondary,send:async()=> '0x32'}
 }),/chain ID 51/);
});
test('XDC receipt audit rejects incomplete journal and tampered aggregate fee',async()=>{
 const f=canonicalXdcFixture(),primary=f.provider(),secondary=f.provider();
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,steps:f.journal.steps.slice(1)},primary,secondary,contractInterface:f.eventInterface
 }),/ten-transaction/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,totalActualFeeWei:'1'},primary,secondary,contractInterface:f.eventInterface
 }),/cumulative fee total/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,steps:f.journal.steps.map((v,i)=>i===2?{...v,status:'submitted'}:v)},
  primary,secondary,contractInterface:f.eventInterface
 }),/missing expected confirmed step/);
});

test('security-gate evidence requires exact decoded custom errors, never a generic revert',async()=>{
 const expected=(name)=>Object.assign(new Error('EVM reverted'),{
  code:'CALL_EXCEPTION',data:revertAbi.encodeErrorResult(name,[])
 });
 const accepted=await requireExpectedVaultRevert(Promise.reject(expected('ThresholdNotMet')),{
  contractInterface:revertAbi,errorName:'ThresholdNotMet',label:'one guardian'
 });
 assert.equal(accepted.verifiedCustomError,true);
 assert.equal(accepted.errorName,'ThresholdNotMet');
 await assert.rejects(requireExpectedVaultRevert(
  Promise.reject(expected('NotTrustedContact')),
  {contractInterface:revertAbi,errorName:'InactivityNotElapsed',label:'premature guardian'}
 ),/NotTrustedContact rather than InactivityNotElapsed/);
 await assert.rejects(requireExpectedVaultRevert(
  Promise.reject(Object.assign(new Error('execution reverted'),{code:'CALL_EXCEPTION',data:'0x'})),
  {contractInterface:revertAbi,errorName:'ThresholdNotMet',label:'one guardian'}
 ),/missing or unrecognized custom revert data/);
 await assert.rejects(requireExpectedVaultRevert(
  Promise.reject(Object.assign(new Error('timeout'),{code:'NETWORK_ERROR'})),
  {contractInterface:revertAbi,errorName:'ThresholdNotMet',label:'one guardian'}
 ),/transport failure is not an EVM contract revert/);
 await assert.rejects(requireExpectedVaultRevert(
  Promise.resolve(true),
  {contractInterface:revertAbi,errorName:'ThresholdNotMet',label:'one guardian'}
 ),/unexpectedly succeeded/);
});

test('XDC final audit rejects missing, altered, or duplicate native payout events',async()=>{
 const f=canonicalXdcFixture();
 const valid=verifyApothemPayoutEvent({
  receipt:f.receipts[7],contractInterface:f.eventInterface,
  contractAddress:f.contractAddress,rescueAddress:f.rescue,
  eventName:'RecoveryExecuted',amountWei:100000000000000000n
 });
 assert.equal(valid.matched,true);
 assert.equal(valid.recipient,f.rescue.toLowerCase());
 const primary=f.provider(),secondary=f.provider();
 const altered=async(expectedIndex,logs)=>({
  ...secondary,
  getTransactionReceipt:async hash=>{
   const r=await secondary.getTransactionReceipt(hash);
   return r===f.receipts[expectedIndex]?{...r,logs}:r;
  }
 });
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,secondary:await altered(7,[]),
  contractInterface:f.eventInterface
 }),/exactly one RecoveryExecuted/);
 const other=f.eventInterface.encodeEventLog(f.eventInterface.getEvent('RecoveryExecuted'),[
  '0x'+'aa'.repeat(20),100000000000000000n
 ]);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,secondary:await altered(7,[{
   address:f.contractAddress,topics:other.topics,data:other.data
  }]),contractInterface:f.eventInterface
 }),/beneficiary or amount/);
 const wrongAmount=f.eventInterface.encodeEventLog(f.eventInterface.getEvent('LateNativeRecovered'),[
  f.rescue,138n
 ]);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,secondary:await altered(9,[{
   address:f.contractAddress,topics:wrongAmount.topics,data:wrongAmount.data
  }]),contractInterface:f.eventInterface
 }),/beneficiary or amount/);
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary,secondary:await altered(9,[
   f.receipts[9].logs[0],f.receipts[9].logs[0]
  ]),contractInterface:f.eventInterface
 }),/exactly one LateNativeRecovered/);
});

test('canonical XDC signer audit binds both guardian approvals to distinct intended wallets',async()=>{
 const f=canonicalXdcFixture();
 const first=verifyApothemIncludedTransaction({
  transaction:f.transactions[5],step:f.journal.steps[5],roles:f.roles,
  contractAddress:f.contractAddress,contractInterface:f.eventInterface
 });
 const second=verifyApothemIncludedTransaction({
  transaction:f.transactions[6],step:f.journal.steps[6],roles:f.roles,
  contractAddress:f.contractAddress,contractInterface:f.eventInterface
 });
 assert.equal(first.signedBy,f.roles.guardianA.toLowerCase());
 assert.equal(second.signedBy,f.roles.guardianB.toLowerCase());
 assert.notEqual(first.signedBy,second.signedBy);
});
test('final XDC proof rejects forged guardian, altered nonce, calldata and destination',async()=>{
 const f=canonicalXdcFixture();
 const cases=[
  {at:5,patch:{from:f.roles.owner}},
  {at:6,patch:{nonce:17}},
  {at:7,patch:{data:'0x12345678'}},
  {at:8,patch:{to:f.roles.rescue}},
  {at:9,patch:{value:1n}},
  {at:1,patch:{chainId:50n}},
  {at:5,patch:{type:2}}
 ];
 for(const {at,patch} of cases){
  const primary=f.provider(),original=f.provider();
  const provider={...original,getTransaction:async hash=>{
   const actual=await original.getTransaction(hash);
   return hash===f.transactions[at].hash?{...actual,...patch}:actual;
  }};
  await assert.rejects(reconcileApothemPublicTrialReceipts({
   journal:f.journal,primary,secondary:provider,contractInterface:f.eventInterface
  }),/violates disposable role policy/);
 }
 const first=f.provider(),second=f.provider();
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary:first,contractInterface:f.eventInterface,
  secondary:{...second,getTransaction:async hash=>{
   const tx=await second.getTransaction(hash);
   return hash===f.transactions[8].hash?{...tx,blockHash:'0x'+'aa'.repeat(32)}:tx;
  }}
 }),/block\/fee differs/);
});

test('XDC payout proof rejects malformed vault log and ignores unrelated emitter',()=>{
 const f=canonicalXdcFixture();
 const valid=f.receipts[7].logs[0];
 assert.throws(()=>verifyApothemPayoutEvent({
  receipt:{logs:[{...valid,data:'0x12'}]},
  contractInterface:f.eventInterface,contractAddress:f.contractAddress,
  rescueAddress:f.rescue,eventName:'RecoveryExecuted',amountWei:100000000000000000n
 }),/could not be decoded/);
 assert.throws(()=>verifyApothemPayoutEvent({
  receipt:{logs:[{...valid,address:'0x'+'ab'.repeat(20)}]},
  contractInterface:f.eventInterface,contractAddress:f.contractAddress,
  rescueAddress:f.rescue,eventName:'RecoveryExecuted',amountWei:100000000000000000n
 }),/exactly one RecoveryExecuted/);
});

test('XDC payout proof rejects missing receipt logs and invalid beneficiary',()=>{
 const f=canonicalXdcFixture();
 const args={receipt:f.receipts[7],contractInterface:f.eventInterface,
  contractAddress:f.contractAddress,rescueAddress:f.rescue,
  eventName:'RecoveryExecuted',amountWei:100000000000000000n};
 assert.throws(()=>verifyApothemPayoutEvent({...args,receipt:{}}),
  /missing verified ABI, addresses or receipt logs/);
 assert.throws(()=>verifyApothemPayoutEvent({...args,rescueAddress:'0x1234'}),
  /missing verified ABI, addresses or receipt logs/);
 assert.throws(()=>verifyApothemPayoutEvent({...args,eventName:'ERC20Recovered'}),
  /missing verified ABI, addresses or receipt logs/);
});

test('XDC payout proof rejects wrong native amount and duplicate vault logs',()=>{
 const f=canonicalXdcFixture();
 const args={receipt:f.receipts[7],contractInterface:f.eventInterface,
  contractAddress:f.contractAddress,rescueAddress:f.rescue,
  eventName:'RecoveryExecuted',amountWei:100000000000000000n};
 assert.throws(()=>verifyApothemPayoutEvent({...args,amountWei:137n}),
  /beneficiary or amount differs/);
 assert.throws(()=>verifyApothemPayoutEvent({...args,
  receipt:{logs:[f.receipts[7].logs[0],f.receipts[7].logs[0]]}}),
  /exactly one RecoveryExecuted/);
});

test('XDC final receipt audit rejects duplicated transaction hashes',async()=>{
 const f=canonicalXdcFixture();
 const steps=f.journal.steps.map(step=>({...step}));
 steps[1]={...steps[1],txHash:steps[0].txHash};
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,steps},primary:f.provider(),secondary:f.provider(),
  contractInterface:f.eventInterface
 }),/cannot count the same transaction twice/);
});

test('XDC final audit rejects wrong journal ordering before RPC calls',async()=>{
 const f=canonicalXdcFixture();
 let calls=0;
 const provider={...f.provider(),send:async()=>{calls++;return '0x33';}};
 const steps=f.journal.steps.map(step=>({...step}));
 [steps[0],steps[1]]=[steps[1],steps[0]];
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,steps},primary:provider,secondary:provider,
  contractInterface:f.eventInterface
 }),/missing expected confirmed step deploy-v051/);
 assert.equal(calls,2);
});
test('XDC final audit rejects mismatched journal receipt block hash',async()=>{
 const f=canonicalXdcFixture();
 const steps=f.journal.steps.map(step=>({...step}));
 steps[4]={...steps[4],receipt:{...steps[4].receipt,
  blockHash:'0x'+'ff'.repeat(32)}};
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,steps},primary:f.provider(),secondary:f.provider(),
  contractInterface:f.eventInterface
 }),/receipt mismatch at owner-heartbeat: blockHash/);
});
test('XDC final audit rejects missing second-provider transaction',async()=>{
 const f=canonicalXdcFixture(),secondary=f.provider();
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary:f.provider(),
  secondary:{...secondary,getTransaction:async hash=>
   hash===f.receipts[6].hash?null:secondary.getTransaction(hash)},
  contractInterface:f.eventInterface
 }),/included transaction identity proof is incomplete/);
});

test('XDC final audit rejects duplicate payout event on either RPC',async()=>{
 const f=canonicalXdcFixture();
 for(const side of ['primary','secondary']){
  const original=f.provider();
  const tampered={...original,getTransactionReceipt:async hash=>{
   const receipt=await original.getTransactionReceipt(hash);
   return hash===f.receipts[7].hash?{...receipt,
    logs:[...receipt.logs,...receipt.logs]}:receipt;
  }};
  await assert.rejects(reconcileApothemPublicTrialReceipts({
   journal:f.journal,primary:side==='primary'?tampered:f.provider(),
   secondary:side==='secondary'?tampered:f.provider(),
   contractInterface:f.eventInterface
  }),/exactly one RecoveryExecuted/);
 }
});

test('XDC final audit rejects incorrect receipt transaction hash',async()=>{
 const f=canonicalXdcFixture();
 const original=f.provider();
 const altered={...original,getTransactionReceipt:async hash=>{
  const receipt=await original.getTransactionReceipt(hash);
  return hash===f.receipts[3].hash?{...receipt,hash:'0x'+'ab'.repeat(32)}:receipt;
 }};
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary:altered,secondary:f.provider(),
  contractInterface:f.eventInterface
 }),/transaction hash|Receipt|receipt/i);
});

test('XDC final audit rejects fee manipulation in one provider transaction',async()=>{
 const f=canonicalXdcFixture(),original=f.provider();
 const tampered={...original,getTransaction:async hash=>{
  const tx=await original.getTransaction(hash);
  return hash===f.receipts[2].hash?{...tx,gasPrice:tx.gasPrice+1n}:tx;
 }};
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary:f.provider(),secondary:tampered,
  contractInterface:f.eventInterface
 }),/block\/fee differs from its receipt/);
});

test('XDC receipt audit rejects altered transaction block number',async()=>{
 const f=canonicalXdcFixture(),original=f.provider();
 const tampered={...original,getTransaction:async hash=>{
  const tx=await original.getTransaction(hash);
  return hash===f.receipts[3].hash?{...tx,blockNumber:tx.blockNumber+1}:tx;
 }};
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary:f.provider(),secondary:tampered,
  contractInterface:f.eventInterface
 }),/block\/fee differs from its receipt/);
});
test('XDC payout proof rejects a log with the wrong event topic',()=>{
 const f=canonicalXdcFixture(),log=f.receipts[7].logs[0];
 assert.throws(()=>verifyApothemPayoutEvent({
  receipt:{logs:[{...log,topics:['0x'+'ff'.repeat(32)]}]},
  contractInterface:f.eventInterface,contractAddress:f.contractAddress,
  rescueAddress:f.rescue,eventName:'RecoveryExecuted',amountWei:100000000000000000n
 }),/exactly one RecoveryExecuted/);
});

test('XDC final audit rejects receipt canonical block missing on either RPC',async()=>{
 const f=canonicalXdcFixture();
 for(const side of ['primary','secondary']){
  const original=f.provider();
  const altered={...original,getBlock:async n=>
   n===f.receipts[8].blockNumber?null:original.getBlock(n)};
  await assert.rejects(reconcileApothemPublicTrialReceipts({
   journal:f.journal,
   primary:side==='primary'?altered:f.provider(),
   secondary:side==='secondary'?altered:f.provider(),
   contractInterface:f.eventInterface
  }),/no longer canonical/);
 }
});
test('XDC final audit rejects journal receipt gas-use tampering',async()=>{
 const f=canonicalXdcFixture();
 const steps=f.journal.steps.map(step=>({...step}));
 steps[2]={...steps[2],receipt:{...steps[2].receipt,gasUsed:'1'}};
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:{...f.journal,steps},primary:f.provider(),secondary:f.provider(),
  contractInterface:f.eventInterface
 }),/receipt mismatch at fund-guardian-b: gasUsed/);
});

test('XDC final audit fails closed on block reorganization during verification',async()=>{
 const f=canonicalXdcFixture();
 for(const side of ['primary','secondary']){
  const original=f.provider(),reads=new Map();
  const unstable={...original,getBlock:async number=>{
   const count=(reads.get(number)??0)+1;
   reads.set(number,count);
   const block=await original.getBlock(number);
   return number===f.receipts[7].blockNumber&&count===2?
    {...block,hash:'0x'+'ff'.repeat(32)}:block;
  }};
  await assert.rejects(reconcileApothemPublicTrialReceipts({
   journal:f.journal,
   primary:side==='primary'?unstable:f.provider(),
   secondary:side==='secondary'?unstable:f.provider(),
   contractInterface:f.eventInterface
  }),/block changed during evidence verification at execute-two-guardian-recovery/);
 }
});

test('XDC final audit rejects transaction signer substitution on secondary RPC',async()=>{
 const f=canonicalXdcFixture(),original=f.provider();
 const altered={...original,getTransaction:async hash=>{
  const tx=await original.getTransaction(hash);
  return hash===f.receipts[5].hash?{...tx,from:f.roles.owner}:tx;
 }};
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary:f.provider(),secondary:altered,
  contractInterface:f.eventInterface
 }),/signer, nonce, target, value or call data violates disposable role policy/);
});
test('XDC final audit rejects forged nonce on primary RPC',async()=>{
 const f=canonicalXdcFixture(),original=f.provider();
 const altered={...original,getTransaction:async hash=>{
  const tx=await original.getTransaction(hash);
  return hash===f.receipts[6].hash?{...tx,nonce:tx.nonce+1}:tx;
 }};
 await assert.rejects(reconcileApothemPublicTrialReceipts({
  journal:f.journal,primary:altered,secondary:f.provider(),
  contractInterface:f.eventInterface
 }),/signer, nonce, target, value or call data violates disposable role policy/);
});
