#!/usr/bin/env node
/**
 * Fixed Apothem (chain 51) read-only deployment preflight.
 * Compiles the exact existing V0.5 recovery contract with pinned solc, queries
 * two public testnet nodes, and attempts an eth_estimateGas SIMULATION only.
 * NEVER accesses signing keys, faucet accounts, sends, or deploys transactions.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  encodeRecoveryVaultConstructor,createApothemReadOnlyDeploymentBudget
} from '../src/chains/evm/apothem-deployment-budget.js';
import {
  compareApothemRpcProviders
} from './xdc-apothem-independent-rpc-check.js';

const CONTRACT='contracts/OmegaVaultRecoveryVaultV050.sol';
const CONTRACT_NAME='OmegaVaultRecoveryVaultV050';
const SOLC_VERSION='0.8.24';
const TEST_ONLY_DEPLOYER='0x'+'11'.repeat(20); // invalid as a live actor: no private key
const CONTACTS=['0x'+'22'.repeat(20),'0x'+'33'.repeat(20)];
const RESCUE='0x'+'44'.repeat(20);
const HEX=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
function quantity(v,label){
 if(typeof v!=='string'||!HEX.test(v))throw new Error(label+' invalid hex quantity');
 return BigInt(v);
}
function readContract(){
 const source=readFileSync(CONTRACT,'utf8');
 if(!source.includes('contract OmegaVaultRecoveryVaultV050'))throw new Error('Expected exact V0.5 OmegaVault recovery source missing.');
 return source;
}
function compileSource(source){
 const input={language:'Solidity',sources:{[CONTRACT]:{content:source}},settings:{
   optimizer:{enabled:true,runs:200},evmVersion:'paris',
   outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
 }};
 // No dependency changes to package.json/package-lock; compiler version pinned.
 const version=execFileSync('npx',['--yes',`solc@${SOLC_VERSION}`,'--version'],{
   encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024
 }).trim();
 if(!version.startsWith('0.8.24+'))throw new Error('Compiler version is not exactly Solidity 0.8.24.');
 const raw=execFileSync('npx',['--yes',`solc@${SOLC_VERSION}`,'--standard-json'],{
   input:JSON.stringify(input),encoding:'utf8',timeout:120000,maxBuffer:20*1024*1024
 });
 const start=raw.indexOf('{');
 if(start<0)throw new Error('Pinned compiler did not return standard JSON.');
 const result=JSON.parse(raw.slice(start));
 const failures=(result.errors??[]).filter(e=>e.severity==='error');
 if(failures.length)throw new Error('Pinned solc compilation failed: '+failures.map(e=>e.formattedMessage??e.message).join(' | ').slice(0,600));
 const c=result.contracts?.[CONTRACT]?.[CONTRACT_NAME];
 if(!c||!Array.isArray(c.abi))throw new Error('Expected V0.5 contract ABI missing.');
 const bin=c.evm?.bytecode?.object,runtime=c.evm?.deployedBytecode?.object;
 if(typeof bin!=='string'||!bin.length||typeof runtime!=='string'||!runtime.length)throw Error('Deployment or runtime bytecode missing.');
 if(!c.abi.some(x=>x.type==='constructor')||!c.abi.some(x=>x.name==='executeRecovery'))throw Error('Incorrect recovery ABI was compiled.');
 return {compilerVersion:version,creation:bin,runtime};
}
async function rpc(fetchImpl,endpoint,method,params=[]){
 if(!['https://rpc.apothem.network','https://erpc.apothem.network'].includes(endpoint))throw Error('Unapproved network endpoint.');
 if(!['eth_chainId','eth_getBlockByNumber','eth_estimateGas'].includes(method))throw Error('Non-read-only RPC method forbidden.');
 const id=51;
 let response;
 try{
   response=await fetchImpl(endpoint,{
     method:'POST',headers:{accept:'application/json','content-type':'application/json'},
     body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(15000)
   });
 }catch(e){throw new Error(endpoint+' transport failed for '+method+': '+String(e?.message??e));}
 if(response?.ok!==true)throw Error('Apothem '+endpoint+' returned HTTP '+String(response?.status??'unknown'));
 let body;try{body=await response.json();}catch{throw Error('Apothem returned malformed JSON');}
 if(body?.jsonrpc!=='2.0'||body.id!==id||Object.hasOwn(body,'error'))throw Error('RPC method '+method+' rejected: '+String(body?.error?.message??'response invalid').slice(0,200));
 return body.result;
}
export async function inspectXdcApothemDeployment({fetchImpl=globalThis.fetch}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('fetch required');
 const compiled=compileSource(readContract());
 const common=await compareApothemRpcProviders({fetchImpl});
 if(common.chainIdDecimal!==51||common.readOnly!==true)throw Error('Apothem network comparison did not verify chain 51.');
 const params=['0x'+BigInt(common.sharedHeight).toString(16),false];
 const [blockA,blockB]=await Promise.all(common.endpoints.map(x=>rpc(fetchImpl,x,'eth_getBlockByNumber',params)));
 if(blockA?.hash?.toLowerCase()!==common.blockHash||blockB?.hash?.toLowerCase()!==common.blockHash)throw Error('Shared Apothem block changed between budget and identity observations.');
 const limitA=quantity(blockA.gasLimit,'first block gasLimit'),limitB=quantity(blockB.gasLimit,'second block gasLimit');
 if(limitA!==limitB||limitA<21000n)throw Error('Independent Apothem block gas limit conflict.');
 const baseA=blockA.baseFeePerGas??null,baseB=blockB.baseFeePerGas??null;
 if(baseA!==baseB)throw Error('Apothem provider base-fee field disagreement.');
 const encoded=encodeRecoveryVaultConstructor({owner:TEST_ONLY_DEPLOYER,contacts:CONTACTS,rescue:RESCUE,threshold:2,inactivitySeconds:45});
 const deploymentData='0x'+compiled.creation+encoded.slice(2);
 const dryRunParams=[{from:TEST_ONLY_DEPLOYER,gasPrice:'0x0',value:'0x0',data:deploymentData}];
 const estimates=await Promise.all(common.endpoints.map(async endpoint=>{
   try{
     const result=await rpc(fetchImpl,endpoint,'eth_estimateGas',dryRunParams);
     const gas=quantity(result,'deployment gas estimate');
     if(gas>limitA)throw Error('Reported estimate exceeds actual shared block gas limit');
     return {endpoint,gasHex:result,issue:null};
   }catch(e){return {endpoint,gasHex:null,issue:String(e?.message??e).slice(0,200)};}
 }));
 const complete=estimates.every(x=>x.gasHex!=null);
 const maximum=complete
   ?'0x'+estimates.map(x=>quantity(x.gasHex,'gas')).reduce((a,b)=>a>b?a:b).toString(16):null;
 const budget=createApothemReadOnlyDeploymentBudget({
   compiledCreationBytecode:compiled.creation,
   estimatedGasHex:maximum,
   providerGasPriceHex:common.gasPriceWei.map(s=>'0x'+BigInt(s).toString(16)),
   baseFeePerGasHex:baseA,
   compilerVersion:compiled.compilerVersion,
   codeSizeBytes:compiled.runtime.length/2
 });
 return Object.freeze({
   ...budget,
   commonBlock:common.sharedHeight,matchingCommonBlockHash:common.blockHash,
   evmVersion:'paris',optimizerRuns:200,contractName:CONTRACT_NAME,
   dryRunDeployer:TEST_ONLY_DEPLOYER,
   dryRunDeployerHasNoPrivateKey:true,
   gasLimitPerBlock:limitA.toString(),
   independentSimulationResults:estimates,
   bothProvidersEstimatedGas:complete,
   simulationReadyWithinFiveFakeXdc:complete&&budget.withinFeeCap,
   deployerFunded:false,realDeploymentAttempted:false,
   deploymentEligible:false
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 inspectXdcApothemDeployment().then(x=>console.log(JSON.stringify(x,null,2)))
   .catch(e=>{console.error('XDC_APOTHEM_DEPLOYMENT_PREFLIGHT_BLOCKED:',String(e?.message??e));process.exitCode=1;});
}
