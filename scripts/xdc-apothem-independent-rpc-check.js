#!/usr/bin/env node
/**
 * Independent, read-only Apothem provider comparison.
 * Cross-checks two fixed Apothem endpoints at the SAME block height.
 * No wallet secrets, signing, deployment, or broadcast.
 */
import { pathToFileURL } from 'node:url';
import { getNetwork } from '../src/chains/network-registry.js';
export const APOTHEM_ENDPOINTS = Object.freeze([
  'https://rpc.apothem.network',
  'https://erpc.apothem.network'
]);
const Q=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const H=/^0x[a-fA-F0-9]{64}$/;
const q=(v,label)=>{if(typeof v!=='string'||!Q.test(v))throw new TypeError(label+' not canonical hex');const n=BigInt(v);if(n>=(1n<<256n))throw new TypeError(label+' exceeds uint256');return n;};
const h=(v,label)=>{if(typeof v!=='string'||!H.test(v)||/^0x0{64}$/i.test(v))throw new TypeError(label+' not a nonzero 32-byte hash');return v.toLowerCase();};
export async function compareApothemRpcProviders({fetchImpl=globalThis.fetch,nowSeconds=Math.floor(Date.now()/1000)}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl is required');
  if(!Number.isSafeInteger(nowSeconds)||nowSeconds<=0)throw new TypeError('nowSeconds must be a positive safe integer');
  const clock=BigInt(nowSeconds);
  const profile=getNetwork('xdc:apothem');
  if(profile?.chainIdHex!=='0x33'||profile.environment!=='testnet')throw Error('Apothem chain identity is not fixed to 51');
  let n=0;
  async function rpc(endpoint,method,params=[]){
    if(!APOTHEM_ENDPOINTS.includes(endpoint)||
       !['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_gasPrice'].includes(method))throw Error('RPC method or host not allowlisted');
    const id=++n;
    let response;
    try {
      response=await fetchImpl(endpoint,{
        method:'POST',headers:{accept:'application/json','content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id,method,params}),
        // Never follow redirects outside the two fixed RPC endpoint origins.
        redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)
      });
    } catch (error) {
      throw new Error('Apothem RPC transport unavailable at '+endpoint+' for '+method+': '+String(error?.message??error));
    }
    if(response?.redirected===true || (typeof response?.url==='string' && response.url && new URL(response.url).href!==new URL(endpoint).href))throw Error('Apothem RPC response redirected outside pinned endpoint');
    if(response?.ok!==true)throw new Error('Apothem provider HTTP status '+String(response?.status??'unknown'));
    let body;try{body=await response.json();}catch{throw Error('Apothem provider invalid JSON');}
    if(body?.jsonrpc!=='2.0'||body.id!==id||Object.hasOwn(body,'error')||!Object.hasOwn(body,'result'))throw Error('Apothem provider malformed response');
    return body.result;
  }
  const [a,b]=APOTHEM_ENDPOINTS;
  const [idA,idB]=await Promise.all([rpc(a,'eth_chainId'),rpc(b,'eth_chainId')]);
  if(q(idA,'first chain ID')!==51n||q(idB,'second chain ID')!==51n)throw Error('Apothem provider chain mismatch: both must report ID 51');
  const [heightA,heightB]=await Promise.all([rpc(a,'eth_blockNumber'),rpc(b,'eth_blockNumber')]);
  const ah=q(heightA,'first latest block'),bh=q(heightB,'second latest block');
  if(ah<=0n||bh<=0n)throw Error('Apothem providers must report non-genesis blocks');
  // Agreement on a historical hash is insufficient if one RPC head is far behind.
  const headSkew=ah>bh?ah-bh:bh-ah;
  if(headSkew>12n)throw Error('Apothem provider head-height divergence exceeds 12 blocks');
  const common=ah<bh?ah:bh;
  const at='0x'+common.toString(16);
  const [blockA,blockB,gasA,gasB]=await Promise.all([
    rpc(a,'eth_getBlockByNumber',[at,false]),rpc(b,'eth_getBlockByNumber',[at,false]),
    rpc(a,'eth_gasPrice'),rpc(b,'eth_gasPrice')
  ]);
  if(q(blockA?.number,'first common block')!==common||q(blockB?.number,'second common block')!==common)throw Error('Apothem provider returned wrong shared block number');
  const hashA=h(blockA?.hash,'first block'),hashB=h(blockB?.hash,'second block');
  if(hashA!==hashB)throw Error('Apothem provider consensus mismatch: common block hash differs');
  // Matching hashes at a historical height do not establish a live, healthy head.
  // Fail closed when the agreed block is old or implausibly ahead of local time.
  const timestampA=q(blockA?.timestamp,'first common block timestamp');
  const timestampB=q(blockB?.timestamp,'second common block timestamp');
  if(timestampA<=0n||timestampA!==timestampB)throw Error('Apothem provider common block timestamp mismatch');
  if(clock-timestampA>900n)throw Error('Apothem shared block is older than 15 minutes');
  if(timestampA-clock>120n)throw Error('Apothem shared block timestamp exceeds clock by more than 2 minutes');
  // The agreed block can reorganize while the fee observations complete.
  // Re-read the SAME height on both independent providers before returning
  // this evidence; never infer finality from two matching snapshots.
  const [confirmA,confirmB]=await Promise.all([
    rpc(a,'eth_getBlockByNumber',[at,false]),
    rpc(b,'eth_getBlockByNumber',[at,false])
  ]);
  for(const [confirmed,label] of [[confirmA,'first'],[confirmB,'second']]){
    if(q(confirmed?.number,label+' rechecked block number')!==common||
       h(confirmed?.hash,label+' rechecked block hash')!==hashA||
       q(confirmed?.timestamp,label+' rechecked block timestamp')!==timestampA)
      throw Error('Apothem shared block changed during provider comparison');
  }
  const feeA=q(gasA,'first fee quote'),feeB=q(gasB,'second fee quote');
  // Bracket the complete observation with identity checks. A provider can
  // switch networks after its initial response while serving matching blocks.
  // This detects observed drift; it is not cryptographic provider attestation.
  const [finalIdA,finalIdB]=await Promise.all([rpc(a,'eth_chainId'),rpc(b,'eth_chainId')]);
  if(q(finalIdA,'first rechecked chain ID')!==51n||q(finalIdB,'second rechecked chain ID')!==51n)
    throw Error('Apothem provider chain mismatch during final identity recheck');
  const delta=feeA>feeB?feeA-feeB:feeB-feeA;
  const min=feeA<feeB?feeA:feeB;
  return Object.freeze({
    schema:'omegavault.xdc.apothem-two-rpc-readonly.v1',
    networkRef:profile.id,chainIdDecimal:51,sharedHeight:common.toString(),
    blockHash:hashA,sharedBlockTimestampSeconds:timestampA.toString(),
    sharedBlockFreshnessVerified:true,sharedBlockRecheckVerified:true,
    chainIdentityRecheckVerified:true,
    endpoints:Object.freeze([a,b]),
    latestHeights:Object.freeze([ah.toString(),bh.toString()]),
    gasPriceWei:Object.freeze([feeA.toString(),feeB.toString()]),
    gasQuotesAgree:feeA===feeB,
    quoteDifferenceWei:delta.toString(),
    quoteRatioGreaterThanTen: min===0n ? feeA!==feeB : (feeA>feeB?feeA:feeB)>min*10n,
    readOnly:true,transactionSigned:false,transactionSubmitted:false,
    deploymentApproved:false,recoveryProven:false
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  compareApothemRpcProviders().then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(e=>{console.error('APOTHEM_RPC_CROSS_CHECK_BLOCKED:',String(e.message??e));process.exitCode=1;});
}

