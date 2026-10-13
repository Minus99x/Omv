#!/usr/bin/env node
/**
 * Read-only Apothem reconnaissance. No wallet inputs, keys, signing,
 * deployment or submission; does not classify a chain as supported.
 */
import { pathToFileURL } from 'node:url';
import { getNetwork } from '../src/chains/network-registry.js';
import { createEvmCompatibilityProbe } from '../src/chains/evm/compatibility-plan.js';
const URL='https://rpc.apothem.network';
const HEX_Q=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const HASH=/^0x[a-f0-9]{64}$/i;
function quantity(v,label){
  if(typeof v!=='string'||!HEX_Q.test(v)) throw new TypeError(label+' must be a canonical hex quantity.');
  return BigInt(v);
}
function hash(v,label){
  if(typeof v!=='string'||!HASH.test(v))throw new TypeError(label+' must be 32-byte hex.');
  return v.toLowerCase();
}
export async function probeXdcApothemReadOnly({fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('A fetch transport is required.');
  const profile=getNetwork('xdc:apothem');
  const plan=createEvmCompatibilityProbe('xdc:apothem');
  if(profile?.environment!=='testnet'||profile.chainIdHex!=='0x33'||
     profile.rpcProtocol!=='evm-json-rpc'||plan.expectedChainIdHex!=='0x33'){
    throw new Error('Expected fixed XDC Apothem chain-51 profile and testnet only.');
  }
  let id=0;
  const rpc=async(method,params=[])=>{
    const methods=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_gasPrice']);
    if(!methods.has(method))throw new Error('Read-only Apothem probe rejects unsupported JSON-RPC methods.');
    const requestId=++id;
    const response=await fetchImpl(URL,{
      method:'POST',
      headers:{accept:'application/json','content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),
      signal:AbortSignal.timeout(15000)
    });
    if(response?.ok!==true)throw new Error('Apothem RPC returned HTTP '+String(response?.status??'unknown')+'.');
    let body;
    try{body=await response.json();}catch{throw new Error('Apothem RPC returned invalid JSON.');}
    if(!body||body.jsonrpc!=='2.0'||body.id!==requestId||Object.hasOwn(body,'error')||!Object.hasOwn(body,'result')){
      throw new Error('Apothem RPC response identity or result is invalid.');
    }
    return body.result;
  };
  const chainId=quantity(await rpc('eth_chainId'),'eth_chainId');
  if(chainId!==51n)throw new Error('Apothem RPC is serving a chain other than chain 51.');
  const latest=quantity(await rpc('eth_blockNumber'),'eth_blockNumber');
  if(latest===0n)throw new Error('Apothem RPC has no observed non-genesis blocks.');
  const observedBlock=await rpc('eth_getBlockByNumber',['0x'+latest.toString(16),false]);
  if(!observedBlock||typeof observedBlock!=='object')throw new Error('Apothem RPC did not return the requested block.');
  const number=quantity(observedBlock.number,'block.number');
  if(number!==latest)throw new Error('Apothem RPC returned a different block height.');
  const blockHash=hash(observedBlock.hash,'block.hash');
  const parentHash=hash(observedBlock.parentHash,'block.parentHash');
  const timestamp=quantity(observedBlock.timestamp,'block.timestamp');
  if(timestamp<=0n)throw new Error('Apothem block has invalid timestamp.');
  const gasPrice=quantity(await rpc('eth_gasPrice'),'eth_gasPrice');
  return Object.freeze({
    schema:'omegavault.xdc.apothem-readonly-probe.v1',
    networkRef:profile.id,
    rpcEndpoint:URL,
    chainIdHex:'0x33',
    chainIdDecimal:51,
    latestBlock:latest.toString(),
    blockHash,parentHash,blockTimestampSeconds:timestamp.toString(),
    gasPriceWei:gasPrice.toString(),
    checkedRpcMethods:['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_gasPrice'],
    readOnly:true,transactionSigned:false,transactionSubmitted:false,
    recoveryProven:false,productionSupportAuthorized:false
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  probeXdcApothemReadOnly().then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(e=>{console.error('XDC_APOTHEM_READONLY_BLOCKED:',String(e?.message??e));process.exitCode=1;});
}
