import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitcoinSignetCoreCliDriver } from '../src/chains/bitcoin/core-cli-driver.js';

test('Bitcoin Core CLI driver restricts local commands to four read-only Signet methods', async () => {
  const calls=[];
  const outputs={
    getnetworkinfo:{version:310100,subversion:'/Satoshi:31.1.0/',protocolversion:70016},
    getblockchaininfo:{chain:'signet'},
    decoderawtransaction:{txid:'ab'.repeat(32)},
    testmempoolaccept:[{allowed:false,'reject-reason':'missing-inputs'}]
  };
  const driver=createBitcoinSignetCoreCliDriver({
    execute:async (binary,args,options) => {
      calls.push({binary,args,options});
      return {stdout:JSON.stringify(outputs[args[1]]),stderr:''};
    }
  });
  assert.equal(driver.provenance,'bitcoin-core-rpc');
  assert.equal((await driver.getNetworkInfo()).version,310100);
  assert.equal((await driver.getBlockchainInfo()).chain,'signet');
  assert.equal((await driver.decodeRawTransaction({rawHex:'ab',networkRef:'bitcoin:signet'})).txid,'ab'.repeat(32));
  assert.equal((await driver.testMempoolAccept({
    rawTransactions:['ab'],maxFeeRate:0,networkRef:'bitcoin:signet'
  }))[0].allowed,false);
  assert.deepEqual(calls.map(c=>c.args),[
    ['-signet','getnetworkinfo'],
    ['-signet','getblockchaininfo'],
    ['-signet','decoderawtransaction','ab'],
    ['-signet','testmempoolaccept','["ab"]','0']
  ]);
  assert.ok(calls.every(c=>c.binary==='bitcoin-cli'&&c.options.shell===false&&c.options.timeout===15000));
  assert.ok(calls.every(c=>!c.args.some(s=>/wallet|password|sendrawtransaction|signrawtransaction/i.test(s))));
});

test('Bitcoin Core CLI driver rejects non-Signet, malformed and multi-transaction requests before execution', async () => {
  let executions=0;
  const driver=createBitcoinSignetCoreCliDriver({
    execute:async()=>{executions++;return {stdout:'{}'};}
  });
  assert.throws(()=>driver.decodeRawTransaction({rawHex:'ab',networkRef:'bitcoin:mainnet'}),/Signet-only/);
  assert.throws(()=>driver.decodeRawTransaction({rawHex:'not-hex',networkRef:'bitcoin:signet'}),/canonical/);
  assert.throws(()=>driver.testMempoolAccept({rawTransactions:['ab','cd'],maxFeeRate:0,networkRef:'bitcoin:signet'}),/single Signet/);
  assert.throws(()=>driver.testMempoolAccept({rawTransactions:['ab'],maxFeeRate:0.1,networkRef:'bitcoin:signet'}),/single Signet/);
  assert.throws(()=>driver.testMempoolAccept({rawTransactions:['ab'],maxFeeRate:0,networkRef:'bitcoin:mainnet'}),/single Signet/);
  assert.equal(executions,0);
});

test('Bitcoin Core CLI driver rejects non-JSON responses and strips machine-specific command failure details', async () => {
  const malformed=createBitcoinSignetCoreCliDriver({execute:async()=>({stdout:'not JSON'})});
  await assert.rejects(()=>malformed.getBlockchainInfo(),/malformed JSON/);
  const unavailable=createBitcoinSignetCoreCliDriver({
    execute:async()=>{throw new Error('local rpc cookie SECRET_XYZ');}
  });
  await assert.rejects(()=>unavailable.getNetworkInfo(),error=>{
    assert.match(error.message,/read-only Core CLI unavailable/);
    assert.doesNotMatch(error.message,/SECRET_XYZ/);
    return true;
  });
});


test('Bitcoin Core CLI requires Signet identity even when invoked through a Signet CLI flag',async()=>{
  for(const observed of [{chain:'main'},{chain:'test'},{}]){
    const driver=createBitcoinSignetCoreCliDriver({execute:async()=>({stdout:JSON.stringify(observed)})});
    await assert.rejects(()=>driver.getBlockchainInfo(),/not Signet chain identity/);
  }
  const driver=createBitcoinSignetCoreCliDriver({execute:async()=>({stdout:'{"chain":"signet"}'})});
  assert.equal((await driver.getBlockchainInfo()).chain,'signet');
});


test('Bitcoin Core CLI validates node version and protocol metadata before evidence promotion',async()=>{
  const base={version:310100,subversion:'/Satoshi:31.1.0/',protocolversion:70016};
  for(const changed of [{version:'310100'},{version:0},{protocolversion:0},{subversion:''},{subversion:{}}]){
    const driver=createBitcoinSignetCoreCliDriver({execute:async()=>({stdout:JSON.stringify({...base,...changed})})});
    await assert.rejects(()=>driver.getNetworkInfo(),/invalid node version/);
  }
  const valid=createBitcoinSignetCoreCliDriver({execute:async()=>({stdout:JSON.stringify(base)})});
  assert.equal((await valid.getNetworkInfo()).version,310100);
});


test('Bitcoin Signet Core mempool acceptance remains exactly one boolean decision',async()=>{
  for(const response of [[],{},[{}],[{allowed:'false'}],[{allowed:true},{allowed:false}],null]){
    const driver=createBitcoinSignetCoreCliDriver({execute:async()=>({stdout:JSON.stringify(response)})});
    await assert.rejects(()=>driver.testMempoolAccept({rawTransactions:['ab'],maxFeeRate:0,networkRef:'bitcoin:signet'}),/malformed single-transaction/);
  }
  const driver=createBitcoinSignetCoreCliDriver({execute:async()=>({stdout:'[{"allowed":false}]'})});
  assert.equal((await driver.testMempoolAccept({rawTransactions:['ab'],maxFeeRate:0,networkRef:'bitcoin:signet'}))[0].allowed,false);
});
