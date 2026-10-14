#!/usr/bin/env node
/**
 * EXPLICITLY OPTED-IN PUBLIC APOTHEM TESTNET trial, never mainnet.
 * Requires an operator-created *encrypted* disposable local keystore and free
 * faucet fake TXDC. No user/customer wallets or unattended faucet bypass.
 * Writes a PUBLIC receipt journal; if interrupted, refuses automatic replay.
 *
 * Intended as an operator-side controlled proof, NOT supported production flow.
 */
import {readFileSync,openSync,writeFileSync,closeSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Wallet,JsonRpcProvider,ContractFactory,Contract,Transaction} from 'ethers';
import {DEFAULT_DIR,loadPublicManifest,hiddenPassword,inspectDisposableFunding} from './xdc-apothem-disposable-wallet.js';
import {inspectV051Candidate} from './xdc-apothem-v051-deployment-preflight.js';
import {compileSource,readContract} from './xdc-apothem-deployment-preflight.js';
import {requirePublicApothemChainId,validateApothemTrialRoles,
 boundedApothemFee,verifyApothemReceipt,verifyApothemRuntimeBytecode,
 XDC_PUBLIC_TRIAL_FEE_LIMIT_WEI,XDC_PUBLIC_TRIAL_DEPOSIT_WEI}
 from '../src/chains/evm/apothem-public-trial-guard.js';

const GATE='OMEGAVAULT_XDC_APOTHEM_DISPOSABLE_LIVE';
const CONFIRM='PUBLIC_APOTHEM_FAKE_TXDC_ONLY';
const PROVIDER='https://rpc.apothem.network';
const GUARDIAN_TOPUP=10n**17n;
const LATE_NATIVE_AMOUNT=137n;
const TX_TIMEOUT_MS=120000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function requireLiveTrialGate(env){
 if(env?.[GATE]!==CONFIRM)throw Error('Public Apothem trial is OFF. Require explicit exact fake-TXDC chain-51 execution opt-in.');
 return true;
}
function writeNew(path,data){
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(data,null,2)+'\n',{encoding:'utf8'});}
 finally{closeSync(fd);}
}
function rewriteAtomic(path,data){
 const temporary=path+'.tmp';
 const fd=openSync(temporary,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(data,null,2)+'\n',{encoding:'utf8'});}
 finally{closeSync(fd);}
 renameSync(temporary,path);
}
async function ensureRevert(promise,label){
 try{await promise;}
 catch(e){
  if(e?.code==='CALL_EXCEPTION'||/execution reverted|revert|missing revert data/i.test(String(e?.message??''))){
   return Object.freeze({rejected:true,reason:label});
  }
  throw Error(label+' could not be established because the read-only call failed unexpectedly: '+String(e?.message??e));
 }
 throw Error(label+' unexpectedly succeeded; execution blocked.');
}
/**
 * Sign the exact bounded chain-51 legacy transaction locally and persist its
 * deterministic transaction hash BEFORE any public-RPC broadcast attempt.
 * If the RPC accepts but drops its response, the journal still identifies
 * the transaction for manual on-chain reconciliation. Never persist raw bytes.
 */
export async function broadcastSignedApothemTransaction({
 signer,network,transaction,recordBeforeBroadcast
}){
 if(typeof recordBeforeBroadcast!=='function')throw TypeError('A durable pre-broadcast journal callback is required.');
 const populated=await signer.populateTransaction(transaction);
 const signedRaw=await signer.signTransaction(populated);
 const signed=Transaction.from(signedRaw);
 const signerAddress=(await signer.getAddress()).toLowerCase();
 const intendedTo=String(transaction.to??'').toLowerCase();
 const signedTo=String(signed.to??'').toLowerCase();
 if(signed.from?.toLowerCase()!==signerAddress||
    signed.chainId!==51n||signed.type!==0||
    signed.gasPrice!==BigInt(transaction.gasPrice)||
    signed.gasLimit!==BigInt(transaction.gasLimit)||
    signed.value!==BigInt(transaction.value??0n)||
    signedTo!==intendedTo||
    signed.data.toLowerCase()!==String(transaction.data??'0x').toLowerCase()||
    !signed.hash)
   throw Error('Signed Apothem transaction differs from bounded chain-51 intent; nothing broadcast.');
 await recordBeforeBroadcast({txHash:signed.hash,nonce:signed.nonce});
 const sent=await network.broadcastTransaction(signedRaw);
 if(sent?.hash?.toLowerCase()!==signed.hash.toLowerCase())
  throw Error('Broadcast response hash differs from pre-journaled signed transaction; reconcile manually.');
 return sent;
}
/**
 * Establish the premature-guardian denial at the actual heartbeat inclusion
 * block, rather than at a drifting 'latest' block. Two receipt confirmations,
 * slow RPCs, or a busy workstation can otherwise advance past 45 seconds and
 * make a legitimate approval look like a security failure.
 */
export async function verifyPrematureGuardianAtHeartbeat({
 network,vault,guardian,heartbeatReceipt,anchor
}){
 if(!heartbeatReceipt||heartbeatReceipt.blockNumber==null||
    !/^0x[0-9a-f]{64}$/i.test(String(heartbeatReceipt.blockHash??'')))
  throw Error('Heartbeat inclusion block and block hash required for early guardian proof.');
 const block=await network.getBlock(heartbeatReceipt.blockNumber);
 if(!block||block.timestamp==null||
    String(block.hash??'').toLowerCase()!==heartbeatReceipt.blockHash.toLowerCase())
  throw Error('Heartbeat inclusion block hash differs from receipt; possible reorganization. Stop and reconcile.');
 if(BigInt(block.timestamp)!==BigInt(anchor))
  throw Error('Heartbeat anchor does not match public inclusion-block timestamp.');
 const blockTag=heartbeatReceipt.blockNumber;
 const proof=await ensureRevert(
  vault.connect(guardian).approveRecovery.staticCall({blockTag}),
  'Guardian approval at heartbeat inclusion block must revert'
 );
 return Object.freeze({...proof,blockNumber:String(blockTag),
  blockHash:heartbeatReceipt.blockHash.toLowerCase(),
  heartbeatTimestamp:String(anchor),historicalBlockCall:true});
}
/**
 * Before marking public recovery proven, independently re-read EVERY expected
 * included receipt and its canonical block from both fixed Apothem RPCs.
 * This is cross-provider agreement at observation time, not XDPoS finality.
 * No signing, keys, or replay are performed by this read-only reconciliation.
 */
export async function reconcileApothemPublicTrialReceipts({journal,primary,secondary}){
 const sequence=['deploy-v051','fund-guardian-a','fund-guardian-b','deposit-vault',
  'owner-heartbeat','guardian-a-approval','guardian-b-approval',
  'execute-two-guardian-recovery','late-native-post-recovery-deposit','sweep-late-native'];
 if(!Array.isArray(journal?.steps)||journal.steps.length!==sequence.length)
  throw Error('Complete ten-transaction Apothem recovery journal required for final receipt audit.');
 const [firstChain,secondChain]=await Promise.all([
  primary.send('eth_chainId',[]),secondary.send('eth_chainId',[])
 ]);
 requirePublicApothemChainId(firstChain);requirePublicApothemChainId(secondChain);
 let total=0n;
 for(let i=0;i<sequence.length;i++){
  const step=journal.steps[i];
  if(step?.label!==sequence[i]||step.status!=='confirmed'||
    typeof step.txHash!=='string'||!step.receipt)
   throw Error('Apothem journal missing expected confirmed step '+sequence[i]);
  const receipts=await Promise.all([
   primary.getTransactionReceipt(step.txHash),
   secondary.getTransactionReceipt(step.txHash)
  ]);
  const normalized=receipts.map(receipt=>verifyApothemReceipt({
   receipt,transactionHash:step.txHash,
   expectedContract:i===0?journal.contractAddress:null
  }));
  for(const key of ['txHash','blockNumber','blockHash','gasUsed','gasPriceWei',
   'actualFeeWei','contractAddress']){
   if(String(normalized[0][key]??'').toLowerCase()!==String(normalized[1][key]??'').toLowerCase()||
      String(normalized[0][key]??'').toLowerCase()!==String(step.receipt[key]??'').toLowerCase())
    throw Error('Apothem cross-provider/journal receipt mismatch at '+sequence[i]+': '+key);
  }
  const blocks=await Promise.all([
   primary.getBlock(receipts[0].blockNumber),
   secondary.getBlock(receipts[1].blockNumber)
  ]);
  if(blocks.some(b=>!b||String(b.hash??'').toLowerCase()!==normalized[0].blockHash))
   throw Error('Apothem receipt block is no longer canonical on both providers at '+sequence[i]);
  total+=BigInt(normalized[0].actualFeeWei);
  if(total>XDC_PUBLIC_TRIAL_FEE_LIMIT_WEI)
   throw Error('Apothem reconciled total fees exceed five fake TXDC.');
 }
 if(total!==BigInt(journal.totalActualFeeWei))
  throw Error('Apothem journal cumulative fee total differs from canonical receipts.');
 return Object.freeze({readOnly:true,transactionCount:sequence.length,
  bothProvidersChain51:true,bothProvidersReceiptsAndBlocksAgree:true,
  totalActualFeeWei:total.toString(),independentXdposFinalityProven:false});
}
async function decryptRoles(dir,password,expected){
 const saved=JSON.parse(readFileSync(join(dir,'secrets.json'),'utf8'));
 if(saved?.schema!=='omegavault.xdc.apothem-encrypted-identities.v1'||saved.chainId!==51)
  throw Error('Wrong disposable encrypted-keystore schema or chain.');
 const identities={};
 for(const role of ['owner','guardianA','guardianB','rescue']){
  if(typeof saved?.encrypted?.[role]!=='string')throw Error('Encrypted disposable '+role+' missing.');
  const wallet=await Wallet.fromEncryptedJson(saved.encrypted[role],password);
  if(wallet.address.toLowerCase()!==expected[role])throw Error('Encrypted account does not match public '+role+' identity.');
  identities[role]=wallet;
 }
 validateApothemTrialRoles(Object.fromEntries(Object.entries(identities).map(([k,v])=>[k,v.address])));
 return Object.freeze(identities);
}
export async function executeDisposableApothemTrial({
 directory=DEFAULT_DIR,env=process.env
}={}){
 requireLiveTrialGate(env);
 const pub=loadPublicManifest(directory);
 const roles=validateApothemTrialRoles(pub.roles);
 const journalPath=join(directory,'execution-journal.json');
 if(existsSync(journalPath))throw Error('Prior execution journal exists; reconcile on-chain transactions before any retry. No automatic replay.');
 const funding=await inspectDisposableFunding({directory});
 if(!funding.fundingVerified||!funding.rescueHasNoCodeOnBothProviders)
  throw Error('Disposable owner faucet funding or EOA-only rescue safety gate not satisfied.');
 const preflight=await inspectV051Candidate();
 const compiled=compileSource(readContract('V051'),'V051');
 if(compiled.runtime.length/2!==preflight.runtimeBytecodeBytes||
    compiled.creation.length/2!==preflight.creationBytecodeBytes)
  throw Error('Deployment-preflight bytecode sizes no longer match the pinned V0.5.1 candidate.');
 const network=new JsonRpcProvider(PROVIDER,undefined,{batchMaxCount:1});
 requirePublicApothemChainId(await network.send('eth_chainId',[]));
 if(await network.getCode(roles.rescue)!=='0x')throw Error('Rescue has deployed bytecode; only disposable EOA rescue allowed.');
 const password=await hiddenPassword('Unlock local disposable testnet keystore (never logged): ');
 const wallets=await decryptRoles(directory,password,roles);
 const owner=wallets.owner.connect(network);
 const a=wallets.guardianA.connect(network),b=wallets.guardianB.connect(network);
 const factory=new ContractFactory(compiled.abi,'0x'+compiled.creation,owner);
 const plan=await factory.getDeployTransaction([roles.guardianA,roles.guardianB],2,45,roles.rescue);
 let fees=0n;
 const journal={
  schema:'omegavault.xdc.apothem-disposable-public-trial.v1',
  network:'xdc:apothem',chainId:51,contractVariant:'V051',
  status:'incomplete',roles,preflightBlock:preflight.commonBlock,
  preflightBufferedFeeWei:preflight.conservativeTxFeeBudgetWei,
  steps:[],totalActualFeeWei:'0',productionReady:false,
  customerWalletsUsed:false,mainnetTouched:false
 };
 // Persist before signing or sending. If a crash occurs, stop rather than replay.
 writeNew(journalPath,journal);
 function save(){rewriteAtomic(journalPath,journal);}
 async function send(label,signer,tx){
  const from=(await signer.getAddress()).toLowerCase();
  if(![roles.owner,roles.guardianA,roles.guardianB].includes(from))
   throw Error('Trial signer is not an approved disposable testnet role.');
  const value=BigInt(tx.value??0n);
  const [gasRaw,estimateRaw,balance]=await Promise.all([
   network.send('eth_gasPrice',[]),
   network.estimateGas({...tx,from}),
   network.getBalance(from)
  ]);
  const guard=boundedApothemFee({estimatedGas:BigInt(estimateRaw),
   gasPriceWei:BigInt(gasRaw),spentFeeWei:fees});
  if(BigInt(balance)<guard.maxFee+value)
   throw Error(label+' wallet does not have enough disposable fake TXDC for the maximum fee and transfer.');
  // Explicit chain/legacy fee (not user-selected provider or automatic mainnet fallback).
  const safeTx={...tx,chainId:51,type:0,gasPrice:guard.gasPriceWei,
   gasLimit:guard.gasLimit};
  const step={label,status:'preparing-signature',from,valueWei:value.toString(),
   maxReservedFeeWei:guard.maxFee.toString(),txHash:null};
  journal.steps.push(step);save();
  const sent=await broadcastSignedApothemTransaction({
   signer,network,transaction:safeTx,
   recordBeforeBroadcast:({txHash,nonce})=>{
    step.txHash=txHash;step.nonce=nonce;step.status='broadcasting';save();
   }
  });
  step.status='submitted';save();
  const received=await network.waitForTransaction(sent.hash,2,TX_TIMEOUT_MS);
  const verified=verifyApothemReceipt({receipt:received,transactionHash:sent.hash});
  const actualFee=BigInt(verified.actualFeeWei);
  fees+=actualFee;
  if(fees>XDC_PUBLIC_TRIAL_FEE_LIMIT_WEI)throw Error('Actual trial fee cap exceeded; stop.');
  Object.assign(step,{status:'confirmed',receipt:verified});
  journal.totalActualFeeWei=fees.toString();save();
  return {receipt:received,verified};
 }
 try{
  const deployment=await send('deploy-v051',owner,plan);
  const contractAddress=deployment.receipt.contractAddress;
  verifyApothemReceipt({receipt:deployment.receipt,
   transactionHash:deployment.receipt.hash,expectedContract:contractAddress});
  const actualCode=await network.getCode(contractAddress);
  const verifiedCode=verifyApothemRuntimeBytecode({
   compiledRuntime:'0x'+compiled.runtime,
   immutableReferences:compiled.immutableReferences,
   actualRuntime:actualCode
  });
  const vault=new Contract(contractAddress,compiled.abi,owner);
  const [recordedOwner,recRescue,recThreshold,recInactivity,recVersion]=await Promise.all([
   vault.owner(),vault.rescueDestination(),vault.threshold(),
   vault.inactivityPeriod(),vault.ADAPTER_VERSION()
  ]);
  if(recordedOwner.toLowerCase()!==roles.owner||recRescue.toLowerCase()!==roles.rescue||
     recThreshold!==2n||recInactivity!==45n||recVersion!==501n)
    throw Error('Deployed immutable policy does not match safe disposable 2-of-2 testnet settings.');
  const configured=(await vault.getTrustedContacts()).map(v=>v.toLowerCase());
  if(configured.length!==2||configured[0]!==roles.guardianA||configured[1]!==roles.guardianB)
   throw Error('Deployed contract guardians differ from encrypted disposable identities.');
  journal.contractAddress=contractAddress;
  journal.runtimeEvidence=verifiedCode;save();

  // Guardian approval fees come from small disposable owner-sent fake-TXDC top-ups,
  // avoiding multiple CAPTCHA faucet claims.
  await send('fund-guardian-a',owner,{to:roles.guardianA,value:GUARDIAN_TOPUP});
  await send('fund-guardian-b',owner,{to:roles.guardianB,value:GUARDIAN_TOPUP});
  const encoded=new Contract(contractAddress,compiled.abi,owner);
  const depositBefore=await network.getBalance(contractAddress);
  if(depositBefore!==0n)throw Error('Newly deployed vault has unexpected funds.');
  await send('deposit-vault',owner,{to:contractAddress,value:XDC_PUBLIC_TRIAL_DEPOSIT_WEI});
  const balance=await network.getBalance(contractAddress);
  if(balance!==XDC_PUBLIC_TRIAL_DEPOSIT_WEI)throw Error('Protected deposit not present in vault.');

  const heartbeatTx=await encoded.heartbeat.populateTransaction();
  const heartbeat=await send('owner-heartbeat',owner,heartbeatTx);
  const anchor=BigInt(await encoded.lastHeartbeat());
  journal.earlyGuard=await verifyPrematureGuardianAtHeartbeat({
   network,vault,guardian:a,heartbeatReceipt:heartbeat.receipt,anchor
  });
  save();
  let eligible=false;
  for(let tries=0;tries<45;tries++){
   const head=await network.getBlock('latest');
   if(head&&BigInt(head.timestamp)>=anchor+45n){eligible=true;break;}
   await sleep(4000);
  }
  if(!eligible)throw Error('Inactivity was not established from recent Apothem block timestamps.');
  await send('guardian-a-approval',a,await vault.connect(a).approveRecovery.populateTransaction());
  if(await vault.approvalCount()!==1n)throw Error('First guardian did not produce exactly one approval.');
  journal.oneGuardianGuard=await ensureRevert(
   vault.executeRecovery.staticCall(),'One guardian alone must not execute 2-of-2 recovery'
  );
  await send('guardian-b-approval',b,await vault.connect(b).approveRecovery.populateTransaction());
  if(await vault.approvalCount()!==2n)throw Error('Two independent guardian approvals not established.');
  const recipientBefore=await network.getBalance(roles.rescue);
  await send('execute-two-guardian-recovery',owner,await encoded.executeRecovery.populateTransaction());
  const [afterRecipient,afterVault,recovered]=await Promise.all([
   network.getBalance(roles.rescue),network.getBalance(contractAddress),encoded.recovered()
  ]);
  if(afterRecipient-recipientBefore!==XDC_PUBLIC_TRIAL_DEPOSIT_WEI||afterVault!==0n||recovered!==true)
   throw Error('Public recovery native-balance conservation or recovered flag mismatch.');
  journal.nativeRecoveryVerified=true;save();

  await send('late-native-post-recovery-deposit',owner,{to:contractAddress,value:LATE_NATIVE_AMOUNT});
  if(await network.getBalance(contractAddress)!==LATE_NATIVE_AMOUNT)
   throw Error('Late native deposit not observed in vault.');
  const lateBefore=await network.getBalance(roles.rescue);
  await send('sweep-late-native',owner,await encoded.recoverLateNative.populateTransaction());
  const [lateAfter,lateVault]=await Promise.all([
   network.getBalance(roles.rescue),network.getBalance(contractAddress)
  ]);
  if(lateAfter-lateBefore!==LATE_NATIVE_AMOUNT||lateVault!==0n)
   throw Error('Late-native payout failed recipient or empty-vault conservation.');
  journal.lateNativeRecoveryVerified=true;
  // A second public RPC must agree on every included transaction, block and
  // actual fee before the journal can claim public native-recovery evidence.
  const secondary=new JsonRpcProvider('https://erpc.apothem.network',undefined,{batchMaxCount:1});
  journal.finalReceiptAudit=await reconcileApothemPublicTrialReceipts({
   journal,primary:network,secondary
  });
  verifyApothemRuntimeBytecode({
   compiledRuntime:'0x'+compiled.runtime,
   immutableReferences:compiled.immutableReferences,
   actualRuntime:await secondary.getCode(contractAddress)
  });
  const secondaryVault=new Contract(contractAddress,compiled.abi,secondary);
  if(await secondaryVault.recovered()!==true||
     await secondary.getBalance(contractAddress)!==0n)
   throw Error('Second Apothem provider does not confirm recovered vault with zero native balance.');
  journal.secondaryRecoveredStateVerified=true;
  journal.status='public-testnet-native-recovery-proven';
  journal.ownerHeartbeatVerified=true;
  journal.twoIndependentGuardiansVerified=true;
  journal.publicApothemTokenRecoveryProven=false;
  journal.xdposFinalityProven=false; // two confirmations != independent finality.
  journal.productionReady=false;save();
  return Object.freeze({
   journalPath,publicContract:contractAddress,transactionCount:journal.steps.length,
   actualTotalFeeWei:fees.toString(),nativeRecoveryVerified:true,
   lateNativeRecoveryVerified:true,publicTokenRecoveryVerified:false,
   independentFinalityVerified:false,productionReady:false
  });
 }catch(error){
  journal.status='incomplete-requires-manual-ledger-reconciliation';
  journal.error=String(error?.message??error).slice(0,300);save();
  throw Error('Trial halted; do NOT rerun or submit duplicate transactions before inspecting execution-journal.json: '+journal.error);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 executeDisposableApothemTrial({directory:process.argv[2]??DEFAULT_DIR})
  .then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(e=>{console.error('XDC_APOTHEM_LIVE_TRIAL_BLOCKED:',String(e?.message??e));process.exitCode=1;});
}
