import test from 'node:test';
import assert from 'node:assert/strict';
import {APOTHEM_ENDPOINTS,compareApothemRpcProviders} from '../scripts/xdc-apothem-independent-rpc-check.js';
const HASH='0x'+'11'.repeat(32);
function mock({chain2='0x33',hash2=HASH,gasA='0x3b9aca00',gasB='0x3b9aca00',headA='0x2b',headB='0x2a',timestampA='0x6553f100',timestampB=timestampA,reorgHashA=null,reorgHashB=null,reorgTimestampB=null,reorgBlockNumberA=null}={}){
 const calls=[];
 const blockReadCounts=[0,0];
 const fetch=async(url,options)=>{
   assert.ok(APOTHEM_ENDPOINTS.includes(url));assert.equal(options.method,'POST');
   assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
   const req=JSON.parse(options.body);calls.push({url,req});
   const second=url===APOTHEM_ENDPOINTS[1];
   const index=second?1:0;
   if(req.method==='eth_getBlockByNumber')blockReadCounts[index]++;
   const recheck=req.method==='eth_getBlockByNumber'&&blockReadCounts[index]===2;
   const results={
     eth_chainId:second?chain2:'0x33',
     eth_blockNumber:second?headB:headA,
     eth_getBlockByNumber:{
       number:recheck&&!second&&reorgBlockNumberA!==null?reorgBlockNumberA:'0x2a',
       hash:recheck?(second?(reorgHashB??hash2):(reorgHashA??HASH)):(second?hash2:HASH),
       timestamp:recheck&&second&&reorgTimestampB!==null?reorgTimestampB:(second?timestampB:timestampA)
     },
     eth_gasPrice:second?gasB:gasA
   };
   if(req.method==='eth_getBlockByNumber')assert.deepEqual(req.params,['0x2a',false]);
   return {ok:true,async json(){return {jsonrpc:'2.0',id:req.id,result:results[req.method]}}};
 };
 return {fetch,calls};
}
test('Apothem read-only comparison validates both chain-51 endpoints at one common height',async()=>{
 const t=mock();const proof=await compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:t.fetch});
 assert.equal(proof.sharedHeight,'42');assert.equal(proof.blockHash,HASH);
 assert.equal(proof.gasQuotesAgree,true);assert.equal(proof.quoteDifferenceWei,'0');
 assert.equal(proof.readOnly,true);assert.equal(proof.deploymentApproved,false);
 assert.equal(t.calls.length,12);
 assert.equal(proof.sharedBlockRecheckVerified,true);
 assert.ok(t.calls.every(x=>!/(sendRaw|sign|deploy|personal)/i.test(x.req.method)));
});
test('Apothem comparison refuses a wrong chain or conflicting ledger hash',async()=>{
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:mock({chain2:'0x32'}).fetch}),/chain mismatch/);
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:mock({hash2:'0x'+'22'.repeat(32)}).fetch}),/consensus mismatch/);
});
test('Apothem comparison reports gas quote disagreement but never approves deployment',async()=>{
 const proof=await compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:mock({gasA:'0x1',gasB:'0x100'}).fetch});
 assert.equal(proof.gasQuotesAgree,false);
 assert.equal(proof.quoteRatioGreaterThanTen,true);
 assert.equal(proof.deploymentApproved,false);
});
test('Apothem comparison rejects missing fetch transport',async()=>{
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:null}),/fetchImpl is required/);
});

test('Apothem comparison refuses lagging provider even with matching historical block hashes',async()=>{
 const t=mock({headA:'0x37',headB:'0x2a'}); // 13 blocks apart
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:t.fetch}),/head-height divergence/);
 assert.equal(t.calls.length,4); // no gas or shared-block reads
});
test('Apothem comparison permits boundary skew of 12 blocks without approval',async()=>{
 const t=mock({headA:'0x36',headB:'0x2a'});
 const proof=await compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:t.fetch});
 assert.deepEqual(proof.latestHeights,['54','42']);
 assert.equal(proof.deploymentApproved,false);
});

test('Apothem comparison rejects identical but stale shared ledger blocks',async()=>{
 const t=mock();
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700001000,fetchImpl:t.fetch}),
  /older than 15 minutes/);
 assert.equal(t.calls.length,8);
});

test('Apothem comparison rejects implausibly future-dated shared block',async()=>{
 const t=mock();
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1699999800,fetchImpl:t.fetch}),
  /exceeds clock by more than 2 minutes/);
});

test('Apothem comparison rejects inconsistent provider timestamps with matching hashes',async()=>{
 const t=mock({timestampB:'0x6553f101'});
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:t.fetch}),
  /timestamp mismatch/);
});

test('Apothem comparison accepts a fresh boundary timestamp without approving deployment',async()=>{
 const t=mock();
 const proof=await compareApothemRpcProviders({nowSeconds:1700000900,fetchImpl:t.fetch});
 assert.equal(proof.sharedBlockTimestampSeconds,'1700000000');
 assert.equal(proof.sharedBlockFreshnessVerified,true);
 assert.equal(proof.deploymentApproved,false);
});

test('Apothem comparison rejects malformed timestamps and invalid local clock',async()=>{
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:mock({timestampA:'broken'}).fetch}),
  /not canonical hex/);
 await assert.rejects(compareApothemRpcProviders({nowSeconds:NaN,fetchImpl:mock().fetch}),
  /positive safe integer/);
});

test('Apothem comparison refuses a reorganization during gas sampling even if initial hashes agree',async()=>{
 const t=mock({reorgHashA:'0x'+'a1'.repeat(32)});
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:t.fetch}),
  /shared block changed during provider comparison/);
 assert.equal(t.calls.length,10);
 assert.ok(t.calls.every(x=>['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_gasPrice'].includes(x.req.method)));
});

test('Apothem comparison refuses a changed timestamp on second provider recheck',async()=>{
 const t=mock({reorgTimestampB:'0x6553f101'});
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:t.fetch}),
  /shared block changed during provider comparison/);
 assert.equal(t.calls.length,10);
});

test('Apothem comparison refuses a response for the wrong block during final recheck',async()=>{
 const t=mock({reorgBlockNumberA:'0x29'});
 await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:t.fetch}),
  /shared block changed during provider comparison/);
 assert.equal(t.calls.length,10);
});

test('Apothem comparison refuses a substituted final response URL before accepting JSON',async()=>{
  const driver=mock();
  const redirecting=async(url,options)=>({
    ...(await driver.fetch(url,options)),
    url:'https://unapproved.example/rpc'
  });
  await assert.rejects(compareApothemRpcProviders({
    nowSeconds:1700000120,fetchImpl:redirecting
  }),/redirected outside pinned endpoint/);
});

test('Apothem comparison rejects zero hashes from either provider on either block read',async()=>{
  for(const endpoint of APOTHEM_ENDPOINTS){
    for(const read of [1,2]){
      const driver=mock();let reads=0;
      const fetchImpl=async(url,options)=>{
        const response=await driver.fetch(url,options);
        const request=JSON.parse(options.body);
        if(url===endpoint&&request.method==='eth_getBlockByNumber'&&++reads===read){
          const body=await response.json();body.result.hash='0x'+'00'.repeat(32);
          return {...response,json:async()=>body};
        }
        return response;
      };
      await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl}),/nonzero 32-byte hash/);
    }
  }
});

test('Apothem comparison reauthenticates both chain identities after all block and fee reads',async()=>{
  for(const endpoint of APOTHEM_ENDPOINTS){
    for(const changedId of ['0x32','0x033',null]){
      const driver=mock();let identityReads=0;
      const fetchImpl=async(url,options)=>{
        const response=await driver.fetch(url,options);
        const request=JSON.parse(options.body);
        if(url===endpoint&&request.method==='eth_chainId'&&++identityReads===2){
          return {...response,json:async()=>({jsonrpc:'2.0',id:request.id,result:changedId})};
        }
        return response;
      };
      await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl}),/chain mismatch|not canonical hex/);
    }
  }
  const driver=mock();
  const proof=await compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:driver.fetch});
  assert.equal(proof.chainIdentityRecheckVerified,true);
  assert.deepEqual(driver.calls.slice(-2).map(({url,req})=>[url,req.method]),
    APOTHEM_ENDPOINTS.map(url=>[url,'eth_chainId']));
});

test('Apothem comparison fails closed when final identity reauthentication is unavailable',async()=>{
  const driver=mock();let identityReads=0;
  const fetchImpl=async(url,options)=>{
    const request=JSON.parse(options.body);
    if(request.method==='eth_chainId'&&++identityReads>2)throw Error('identity recheck offline');
    return driver.fetch(url,options);
  };
  await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl}),/identity recheck offline/);
});

test('Apothem comparison rejects RPC quantities outside uint256 bounds',async()=>{
 const huge='0x1'+'0'.repeat(64);
 for(const override of [{headA:huge},{gasB:huge},{timestampA:huge}]){
  await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:mock(override).fetch}),/exceeds uint256/);
 }
});


test('Apothem comparison rejects the first value beyond uint256 in every quantity position',async()=>{
 const overflow='0x1'+'0'.repeat(64);
 for(const override of [{headB:overflow},{gasA:overflow},{timestampB:overflow}]){
  await assert.rejects(compareApothemRpcProviders({nowSeconds:1700000120,fetchImpl:mock(override).fetch}),/exceeds uint256/);
 }
});

test('Apothem comparison rejects malformed JSON-RPC envelopes from either pinned provider',async()=>{
 for(const endpoint of APOTHEM_ENDPOINTS){
  for(const failure of ['wrong-id','rpc-error','missing-result','wrong-version']){
   const driver=mock();
   const fetchImpl=async(url,options)=>{
    const response=await driver.fetch(url,options);
    if(url!==endpoint)return response;
    const request=JSON.parse(options.body);
    const body=await response.json();
    if(failure==='wrong-id')body.id=request.id+1;
    if(failure==='rpc-error')body.error={code:-32000,message:'unavailable'};
    if(failure==='missing-result')delete body.result;
    if(failure==='wrong-version')body.jsonrpc='1.0';
    return {...response,json:async()=>body};
   };
   await assert.rejects(compareApothemRpcProviders({
    nowSeconds:1700000120,fetchImpl
   }),/malformed response/,endpoint+' '+failure);
  }
 }
});
