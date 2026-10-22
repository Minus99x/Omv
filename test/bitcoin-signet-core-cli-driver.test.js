import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitcoinSignetObservationCoreCliDriver } from '../src/chains/bitcoin/signet-core-cli-driver.js';

const TXID = 'ab'.repeat(32), BLOCK = 'cd'.repeat(32), TIP = 'ef'.repeat(32);
function fixture(overrides = {}) {
  const calls = [];
  const replies = {
    getrawtransaction:{txid:TXID,blockhash:BLOCK,confirmations:6,in_active_chain:true},
    getblockheader:{hash:BLOCK,height:300000,confirmations:6},
    getblockchaininfo:{chain:'signet',blocks:300005,bestblockhash:TIP,initialblockdownload:false},
    getblockhash:BLOCK,
    gettxout:{bestblock:TIP,confirmations:6,value:0.00099,scriptPubKey:{hex:'0014'+'11'.repeat(20)}},
    ...overrides
  };
  const driver = createBitcoinSignetObservationCoreCliDriver({
    now:()=> '2026-10-22T18:00:00Z',
    execute:async(binary,args,opts)=>{
      calls.push({binary,args,opts});
      const reply = replies[args[1]];
      return {stdout: args[1] === 'getblockhash' ? String(reply) : JSON.stringify(reply)};
    }
  });
  return {driver,calls};
}

test('Signet observation Core CLI reads only five fixed methods and binds chain identity', async () => {
  const {driver,calls} = fixture();
  const transaction=await driver.readTransaction({transactionId:TXID,networkRef:'bitcoin:signet'});
  const tip=await driver.readChainTip({networkRef:'bitcoin:signet'});
  const atHeight=await driver.readBlockHashAtHeight({blockHeight:300000,networkRef:'bitcoin:signet'});
  const utxo=await driver.readTxOut({transactionId:TXID,vout:0,networkRef:'bitcoin:signet'});
  assert.equal(driver.provenance,'bitcoin-core-rpc');
  assert.equal(transaction.confirmations,6);
  assert.equal(transaction.blockHeight,300000);
  assert.equal(tip.blockHeight,300005);
  assert.equal(atHeight,BLOCK);
  assert.equal(utxo.amountSats,'99000');
  assert.equal(utxo.bestBlockHash,TIP);
  assert.equal(utxo.confirmations,6);
  assert.equal(utxo.unspent,true);
  assert.deepEqual(calls.map(v=>v.args[1]),[
    'getrawtransaction','getblockheader','getblockchaininfo','getblockhash','gettxout'
  ]);
  assert.ok(calls.every(c=>c.binary==='bitcoin-cli'&&c.args[0]==='-signet'&&
    c.opts.shell===false&&c.opts.timeout===15000));
  assert.ok(calls.every(c=>!c.args.join(' ').match(/signrawtransaction|sendrawtransaction|wallet|password|seed/i)));
});

test('Signet observation Core adapter rejects non-Signet, invalid txids, heights and vout before execution', async () => {
  const {driver,calls}=fixture();
  await assert.rejects(()=>driver.readTransaction({transactionId:TXID,networkRef:'bitcoin:mainnet'}),/Signet-only/);
  await assert.rejects(()=>driver.readTransaction({transactionId:'not-a-txid',networkRef:'bitcoin:signet'}),/32-byte hex/);
  await assert.rejects(()=>driver.readBlockHashAtHeight({blockHeight:0,networkRef:'bitcoin:signet'}),/uint32 height/);
  await assert.rejects(()=>driver.readBlockHashAtHeight({blockHeight:2**32,networkRef:'bitcoin:signet'}),/uint32 height/);
  await assert.rejects(()=>driver.readTxOut({transactionId:TXID,vout:-1,networkRef:'bitcoin:signet'}),/uint32/);
  await assert.rejects(()=>driver.readTxOut({transactionId:TXID,vout:'0',networkRef:'bitcoin:signet'}),/uint32/);
  assert.equal(calls.length,0);
});

test('Signet Core observation rejects stale-chain, mismatched-header and spent-output claims', async () => {
  await assert.rejects(()=>fixture({getrawtransaction:{txid:TXID,blockhash:BLOCK,confirmations:6,in_active_chain:false}}).driver.readTransaction({transactionId:TXID,networkRef:'bitcoin:signet'}),/not on active/);
  await assert.rejects(()=>fixture({getblockheader:{hash:TIP,height:300000,confirmations:6}}).driver.readTransaction({transactionId:TXID,networkRef:'bitcoin:signet'}),/header identity/);
  await assert.rejects(()=>fixture({getblockchaininfo:{chain:'main',blocks:300005,bestblockhash:TIP}}).driver.readChainTip({networkRef:'bitcoin:signet'}),/synchronized Signet/);
  await assert.rejects(()=>fixture({gettxout:null}).driver.readTxOut({transactionId:TXID,vout:0,networkRef:'bitcoin:signet'}),/spent or not/);
});

test('Signet Core UTXO amount conversion rejects fractional sats, malformed decimals and spoofing', async () => {
  for(const amount of [0.000990001,'0.000990001',NaN,-1,0, '1e-8',{},'21000001']) {
    await assert.rejects(()=>fixture({gettxout:{bestblock:TIP,confirmations:6,value:amount,scriptPubKey:{hex:'51'}}}).driver.readTxOut({transactionId:TXID,vout:0,networkRef:'bitcoin:signet'}),/satoshi|decimal|money|finite|value/i);
  }
  const valid=await fixture({gettxout:{bestblock:TIP,confirmations:6,value:'0.00000001',scriptPubKey:{hex:'51'}}}).driver.readTxOut({transactionId:TXID,vout:0,networkRef:'bitcoin:signet'});
  assert.equal(valid.amountSats,'1');
});

test('Signet Core observation does not leak executable stderr or parse invalid JSON as proof', async () => {
  const unavailable=createBitcoinSignetObservationCoreCliDriver({
    execute:async()=>{throw new Error('private cookie AUTH_TOKEN');}
  });
  await assert.rejects(()=>unavailable.readChainTip({networkRef:'bitcoin:signet'}),error=>{
    assert.match(error.message,/unavailable or rejected/);
    assert.doesNotMatch(error.message,/AUTH_TOKEN/);
    return true;
  });
  const malformed=createBitcoinSignetObservationCoreCliDriver({execute:async()=>({stdout:'not JSON'})});
  await assert.rejects(()=>malformed.readChainTip({networkRef:'bitcoin:signet'}),/malformed JSON/);
});

test('Bitcoin Core requires stable matching header and transaction confirmation depth', async () => {
  const {driver}=fixture({
    getblockheader:{hash:BLOCK,height:300000,confirmations:5}
  });
  await assert.rejects(
    ()=>driver.readTransaction({transactionId:TXID,networkRef:'bitcoin:signet'}),
    /confirmation depth changed/
  );
});

test('Bitcoin Core UTXO rejects malformed confirmation and bestblock responses', async () => {
  for (const change of [
    { confirmations:0, bestblock:TIP },
    { confirmations:'6', bestblock:TIP },
    { confirmations:6, bestblock:'wrong' }
  ]) {
    const {driver}=fixture({gettxout:{
      ...change,value:'0.00099000',scriptPubKey:{hex:'0014'+'11'.repeat(20)}
    }});
    await assert.rejects(
      ()=>driver.readTxOut({transactionId:TXID,vout:0,networkRef:'bitcoin:signet'}),
      /positive uint32|32-byte hex/
    );
  }
});
