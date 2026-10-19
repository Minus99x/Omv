import test from 'node:test';
import assert from 'node:assert/strict';
import { probeXdcApothemReadOnly } from '../scripts/xdc-apothem-readonly-probe.js';
const URL='https://rpc.apothem.network';
const block={number:'0x2a',hash:'0x'+'11'.repeat(32),parentHash:'0x'+'22'.repeat(32),timestamp:'0x5f5e100'};
function transport({chain='0x33',height='0x2a',blockResult=block,gas='0x3b9aca00',badId=false}={}){
 const calls=[];
 const results={eth_chainId:chain,eth_blockNumber:height,eth_getBlockByNumber:blockResult,eth_gasPrice:gas};
 return {calls,fetch:async(url,options)=>{
   assert.equal(url,URL);assert.equal(options.method,'POST');
   const body=JSON.parse(options.body);
   calls.push(body);
   assert.deepEqual(Object.keys(body).sort(),['id','jsonrpc','method','params']);
   if(body.method==='eth_getBlockByNumber')assert.deepEqual(body.params,['0x2a',false]);
   return {ok:true,async json(){return {jsonrpc:'2.0',id:badId?1000:body.id,result:results[body.method]}}};
 }};
}
test('XDC Apothem read-only probe verifies public chain 51, block identity, and fee observation',async()=>{
 const mocked=transport();
 const result=await probeXdcApothemReadOnly({fetchImpl:mocked.fetch});
 assert.equal(result.chainIdDecimal,51);
 assert.equal(result.latestBlock,'42');
 assert.equal(result.gasPriceWei,'1000000000');
 assert.equal(result.blockHash,block.hash);
 assert.equal(result.readOnly,true);
 assert.equal(result.recoveryProven,false);
 assert.deepEqual(mocked.calls.map(x=>x.method),['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_gasPrice']);
 assert.equal(mocked.calls.every(x=>x.id>=1&&x.jsonrpc==='2.0'),true);
});
test('XDC Apothem read-only probe rejects mainnet or mismatched block and refuses proof promotion',async()=>{
 for(const options of [
  {chain:'0x32'},
  {chain:'0x1'},
  {blockResult:{...block,number:'0x2b'}},
  {blockResult:{...block,hash:'0xdeadbeef'}},
  {badId:true}
 ]){
  const mocked=transport(options);
  await assert.rejects(probeXdcApothemReadOnly({fetchImpl:mocked.fetch}),/other than chain 51|different block height|32-byte hex|response identity or result/);
  assert.equal(mocked.calls.some(x=>/send|sign|personal|deploy/.test(x.method)),false);
 }
});
test('XDC Apothem probe rejects unavailable transport or malformed numeric observation',async()=>{
 await assert.rejects(probeXdcApothemReadOnly({fetchImpl:null}),/fetch transport is required/);
 const mocked=transport({gas:'0x-1'});
 await assert.rejects(probeXdcApothemReadOnly({fetchImpl:mocked.fetch}),/canonical hex quantity/);
});

test('XDC read-only probe rejects unexpected response URL and omits credentials and redirects',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return {url:'https://untrusted.example/rpc',ok:true,async json(){return {jsonrpc:'2.0',id:1,result:'0x33'};}};
  };
  await assert.rejects(probeXdcApothemReadOnly({fetchImpl}),/redirected outside pinned endpoint/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,URL);
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.credentials,'omit');
});

test('XDC accepts explicit pinned response URLs for all four read-only methods',async()=>{
  const mocked=transport();
  const fetchImpl=async(url,options)=>({
    ...await mocked.fetch(url,options),
    url:URL
  });
  const result=await probeXdcApothemReadOnly({fetchImpl});
  assert.equal(result.readOnly,true);
  assert.deepEqual(mocked.calls.map(call=>call.method),[
    'eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_gasPrice'
  ]);
});

test('XDC rejects malformed RPC response URLs before parsing their JSON',async()=>{
  let parsed=false;
  const fetchImpl=async()=>({
    url:'not a valid absolute URL',ok:true,
    async json(){parsed=true;return {jsonrpc:'2.0',id:1,result:'0x33'};}
  });
  await assert.rejects(probeXdcApothemReadOnly({fetchImpl}),/Invalid URL|Invalid URL string/i);
  assert.equal(parsed,false);
});
