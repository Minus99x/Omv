#!/usr/bin/env node
/**
 * OmegaVault disposable public Apothem wallet starter.
 * PREPARE: purely offline, encrypts four FRESH ephemeral identities to a
 * local, exclusive-create keystore outside the source tree. Prints addresses only.
 * STATUS: reads PUBLIC manifest only; does not decrypt or sign.
 * The real-network transaction executor is a separate explicitly gated command.
 */
import {mkdirSync,openSync,writeFileSync,closeSync,readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Wallet} from 'ethers';
import {validateApothemTrialRoles,requirePublicApothemChainId,
 XDC_PUBLIC_TRIAL_NETWORK} from '../src/chains/evm/apothem-public-trial-guard.js';

const DEFAULT_DIR=join(homedir(),'.omegavault-test','xdc-apothem-disposable');
const NAMES=['owner','guardianA','guardianB','rescue'];
export function requirePrivateDirectoryOutsideGit(directory){
 let path=resolve(directory);
 while(true){
  if(existsSync(join(path,'.git')))throw new Error('Disposable encrypted Testnet wallets cannot be saved inside a Git repository.');
  const parent=dirname(path);
  if(parent===path)break;
  path=parent;
 }
 return resolve(directory);
}
function fileIn(dir,name){return join(dir,name);}
function writeExclusive(path,obj){
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(obj,null,2)+'\n',{encoding:'utf8'});}
 finally{closeSync(fd);}
}
export function validateDisposablePublicManifest(manifest){
 if(manifest?.schema!=='omegavault.xdc.apothem-public-identities.v1'||
    manifest?.chainId!==51||manifest?.network!=='xdc:apothem'||
    manifest?.mainnetAllowed!==false||manifest?.testnetOnly!==true)
   throw Error('Disposable manifest missing strict chain 51 public-identity boundary.');
 const roles=validateApothemTrialRoles(manifest.roles);
 return Object.freeze({schema:manifest.schema,network:manifest.network,roles});
}
export async function createEncryptedDisposableBundle({password,walletFactory=()=>Wallet.createRandom()}={}){
 if(typeof password!=='string'||password.length<12||password.length>256)
  throw Error('Disposable encryption passphrase must contain 12 to 256 characters.');
 const wallets=Object.fromEntries(NAMES.map(n=>[n,walletFactory()]));
 const roles=Object.fromEntries(NAMES.map(n=>[n,wallets[n].address]));
 const validated=validateApothemTrialRoles(roles);
 const encrypted={};
 for(const name of NAMES){
   if(typeof wallets[name].encrypt!=='function')throw Error('Wallet must support password encryption.');
   encrypted[name]=await wallets[name].encrypt(password);
 }
 const publicManifest={
  schema:'omegavault.xdc.apothem-public-identities.v1',
  network:'xdc:apothem',chainId:51,testnetOnly:true,mainnetAllowed:false,
  roles:validated,
  note:'All keys in secrets.json are encrypted and disposable. Never commit, upload or paste them.'
 };
 return Object.freeze({publicManifest,secrets:Object.freeze({
  schema:'omegavault.xdc.apothem-encrypted-identities.v1',
  chainId:51,encrypted
 })});
}
export function loadPublicManifest(directory=DEFAULT_DIR){
 const file=fileIn(directory,'public.json');
 return validateDisposablePublicManifest(JSON.parse(readFileSync(file,'utf8')));
}
export async function inspectDisposableFunding({
 directory=DEFAULT_DIR,fetchImpl=globalThis.fetch
}={}){
 if(typeof fetchImpl!=='function')throw TypeError('HTTP transport is required.');
 const {roles}=loadPublicManifest(directory);
 let nextId=0;
 async function rpc(endpoint,method,params=[]){
   if(!XDC_PUBLIC_TRIAL_NETWORK.endpoints.includes(endpoint)||
      !['eth_chainId','eth_getBalance','eth_getCode'].includes(method))
     throw Error('Only fixed read-only Apothem methods allowed.');
   const id=++nextId;
   const response=await fetchImpl(endpoint,{
    method:'POST',headers:{accept:'application/json','content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params}),
    signal:AbortSignal.timeout(15000)
   });
   if(response?.ok!==true)throw Error('Apothem RPC '+endpoint+' unreachable.');
   const result=await response.json();
   if(result?.jsonrpc!=='2.0'||result.id!==id||Object.hasOwn(result,'error')||
      !Object.hasOwn(result,'result'))throw Error('Apothem RPC identity or data invalid.');
   return result.result;
 }
 const [first,second]=XDC_PUBLIC_TRIAL_NETWORK.endpoints;
 const [idA,idB]=await Promise.all([rpc(first,'eth_chainId'),rpc(second,'eth_chainId')]);
 requirePublicApothemChainId(idA);requirePublicApothemChainId(idB);
 const [ownerA,ownerB,rescueA,rescueB,guardianA,guardianB]=await Promise.all([
  rpc(first,'eth_getBalance',[roles.owner,'latest']),
  rpc(second,'eth_getBalance',[roles.owner,'latest']),
  rpc(first,'eth_getCode',[roles.rescue,'latest']),
  rpc(second,'eth_getCode',[roles.rescue,'latest']),
  rpc(first,'eth_getBalance',[roles.guardianA,'latest']),
  rpc(first,'eth_getBalance',[roles.guardianB,'latest'])
 ]);
 const hex=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
 for(const v of [ownerA,ownerB,guardianA,guardianB]){
   if(typeof v!=='string'||!hex.test(v))throw Error('Apothem malformed balance observation.');
 }
 if(rescueA!=='0x'||rescueB!=='0x')throw Error('Disposable rescue destination must be an EOA, not deployed code.');
 return Object.freeze({
  schema:'omegavault.xdc.apothem-disposable-funding-readiness.v1',
  network:'xdc:apothem',chainId:51,roles,
  faucetAddress:roles.owner,
  faucetUrl:'https://faucet.apothem.network/',
  ownerBalanceWei:ownerA,
  ownerSecondProviderBalanceWei:ownerB,
  guardianBalancesWei:Object.freeze([guardianA,guardianB]),
  rescueHasNoCodeOnBothProviders:true,
  fundingVerified:BigInt(ownerA)>=3n*10n**18n&&BigInt(ownerB)>=3n*10n**18n,
  fundedAccountRequired:'At least 3 fake TXDC in fresh disposable owner before advancing; re-check fees at execution.',
  privateKeysAccessed:false,transactionSubmitted:false,liveRecoveryProven:false
 });
}
async function hiddenPassword(question){
 if(!process.stdin.isTTY||!process.stdin.setRawMode||!process.stdout.isTTY)
  throw new Error('Encrypted wallet creation/unlock requires an interactive local TTY; secrets cannot be passed in command arguments.');
 process.stdout.write(question);
 return new Promise((resolve,reject)=>{
  let input='';
  const stop=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
  const onData=data=>{
   for(const char of String(data)){
    if(char==='\u0003'){stop();reject(Error('Cancelled by operator.'));return;}
    if(char==='\r'||char==='\n'){stop();resolve(input);return;}
    if(char==='\x7f'||char==='\b'){input=input.slice(0,-1);continue;}
    if(char==='\x1b')continue;
    input+=char;
   }
  };
  process.stdin.setEncoding('utf8');process.stdin.setRawMode(true);process.stdin.resume();
  process.stdin.on('data',onData);
 });
}
export {hiddenPassword,DEFAULT_DIR};
async function main(){
 const command=process.argv[2]??'';
 const dir=process.argv[3]?resolve(process.argv[3]):DEFAULT_DIR;
 if(command==='prepare'){
   requirePrivateDirectoryOutsideGit(dir);
   const pass=await hiddenPassword('New disposable-wallet encryption passphrase: ');
   const confirm=await hiddenPassword('Re-enter encryption passphrase: ');
   if(pass!==confirm)throw Error('Passphrases do not match.');
   const result=await createEncryptedDisposableBundle({password:pass});
   mkdirSync(dir,{recursive:true,mode:0o700});
   // First write encrypted secrets; only then publish the funding address.
   writeExclusive(fileIn(dir,'secrets.json'),result.secrets);
   writeExclusive(fileIn(dir,'public.json'),result.publicManifest);
   console.log(JSON.stringify({
     savedDirectory:dir,network:'xdc:apothem',
     faucetAddress:result.publicManifest.roles.owner,
     guardians:[result.publicManifest.roles.guardianA,result.publicManifest.roles.guardianB],
     rescue:result.publicManifest.roles.rescue,
     next:'Fund only this fake-TXDC testnet faucet address, then run status.',
     privateKeysPrinted:false
   },null,2));
 }else if(command==='status'){
   console.log(JSON.stringify(await inspectDisposableFunding({directory:dir}),null,2));
 }else{
   throw Error('Usage: node scripts/xdc-apothem-disposable-wallet.js prepare [private-directory] | status [private-directory]');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(e=>{console.error('XDC_DISPOSABLE_WALLET_BLOCKED:',String(e.message??e));process.exitCode=1;});
}
