import test from 'node:test';
import assert from 'node:assert/strict';
import {APOTHEM_ENDPOINTS,compareApothemRpcProviders} from '../scripts/xdc-apothem-independent-rpc-check.js';
const HASH='0x'+'11'.repeat(32);
function mock({chain2='0x33',hash2=HASH,gasA='0x3b9aca00',gasB='0x3b9aca00'}={}){
 const calls=[];
 const fetch=async(url,options)=>{
   assert.ok(APOTHEM_ENDPOINTS.includes(url));assert.equal(options.method,'POST');
   const req=JSON.parse(options.body);calls.push({url,req});
   const second=url===APOTHEM_ENDPOINTS[1];
   const results={
     eth_chainId:second?chain2:'0x33',
     eth_blockNumber:second?'0x2a':'0x2b',
     eth_getBlockByNumber:{number:'0x2a',hash:second?hash2:HASH},
     eth_gasPrice:second?gasB:gasA
   };
   if(req.method==='eth_getBlockByNumber')assert.deepEqual(req.params,['0x2a',false]);
   return {ok:true,async json(){return {jsonrpc:'2.0',id:req.id,result:results[req.method]}}};
 };
 return {fetch,calls};
}
test('Apothem read-only comparison validates both chain-51 endpoints at one common height',async()=>{
 const t=mock();const proof=await compareApothemRpcProviders({fetchImpl:t.fetch});
 assert.equal(proof.sharedHeight,'42');assert.equal(proof.blockHash,HASH);
 assert.equal(proof.gasQuotesAgree,true);assert.equal(proof.quoteDifferenceWei,'0');
 assert.equal(proof.readOnly,true);assert.equal(proof.deploymentApproved,false);
 assert.equal(t.calls.length,8);
 assert.ok(t.calls.every(x=>!/(sendRaw|sign|deploy|personal)/i.test(x.req.method)));
});
test('Apothem comparison refuses a wrong chain or conflicting ledger hash',async()=>{
 await assert.rejects(compareApothemRpcProviders({fetchImpl:mock({chain2:'0x32'}).fetch}),/chain mismatch/);
 await assert.rejects(compareApothemRpcProviders({fetchImpl:mock({hash2:'0x'+'22'.repeat(32)}).fetch}),/consensus mismatch/);
});
test('Apothem comparison reports gas quote disagreement but never approves deployment',async()=>{
 const proof=await compareApothemRpcProviders({fetchImpl:mock({gasA:'0x1',gasB:'0x100'}).fetch});
 assert.equal(proof.gasQuotesAgree,false);
 assert.equal(proof.quoteRatioGreaterThanTen,true);
 assert.equal(proof.deploymentApproved,false);
});
test('Apothem comparison rejects missing fetch transport',async()=>{
 await assert.rejects(compareApothemRpcProviders({fetchImpl:null}),/fetchImpl is required/);
});
