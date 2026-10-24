import test from 'node:test';
import assert from 'node:assert/strict';
import {createBitcoinSignetCoreCliDriver} from '../src/chains/bitcoin/core-cli-driver.js';
const tip={chain:'signet',initialblockdownload:false,blocks:300000,headers:300000,bestblockhash:'ab'.repeat(32)};
const node={version:310100,subversion:'/Satoshi:31.1.0/',protocolversion:70016};
const driverFor=response=>createBitcoinSignetCoreCliDriver({
 execute:async()=>({stdout:JSON.stringify(response)})
});
test('Core node metadata refuses control-character subversion spoofing',async()=>{
 for(const subversion of ['/Satoshi:31.1.0/\nspoof','/Satoshi:31.1.0/\t',
   '/Satoshi:31.1.0/\u0000'])
  await assert.rejects(()=>driverFor({...node,subversion}).getNetworkInfo(),/invalid node version/);
 assert.equal((await driverFor(node).getNetworkInfo()).version,310100);
});
test('Core Signet identity requires fully synchronized chain state',async()=>{
 for(const value of [true,null,undefined,0,1,'false'])
  await assert.rejects(()=>driverFor({...tip,initialblockdownload:value}).getBlockchainInfo(),
    /synchronized Signet tip/);
 assert.equal((await driverFor(tip).getBlockchainInfo()).chain,'signet');
});
test('Core Signet tip rejects contradictory or malformed block/header heights',async()=>{
 for(const fields of [{blocks:-1},{blocks:'300000'},{headers:299999},
   {headers:'300000'},{headers:null}])
  await assert.rejects(()=>driverFor({...tip,...fields}).getBlockchainInfo(),
    /synchronized Signet tip/);
});
test('Core Signet tip binds a nonzero canonical 32-byte block hash',async()=>{
 for(const hash of ['0'.repeat(64),'abcd',null,123,[],{}])
  await assert.rejects(()=>driverFor({...tip,bestblockhash:hash}).getBlockchainInfo(),
    /synchronized Signet tip/);
});
