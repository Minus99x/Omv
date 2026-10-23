import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,chmodSync,existsSync } from 'node:fs';
import { join,delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash,encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { createBitcoinFinalizerEvidence } from '../src/chains/bitcoin/finalizer-evidence.js';
import { createBitcoinFinalTransactionEvidence } from '../src/chains/bitcoin/transaction-finalizer.js';

const priv=n=>Buffer.from(n.toString(16).padStart(64,'0'),'hex');
const pub=k=>Buffer.from(secp256k1.getPublicKey(k,true)).toString('hex');
function setup() {
  const dir=mkdtempSync(join(tmpdir(),'omegavault-signet-observation-'));
  const binaryDir=join(dir,'bin');mkdirSync(binaryDir);
  const descriptor=createBitcoinRecoveryDescriptor({
    ownerKey:pub(priv(1)),contactKeys:[pub(priv(2)),pub(priv(3))],
    threshold:2,csvBlocks:144,network:'signet'
  });
  const rescue='0014'+'11'.repeat(20);
  const intent={
    txVersion:2,fallbackLocktime:0,txModifiable:0,
    inputs:[{txid:'ab'.repeat(32),vout:0,sequence:144,amountSats:'100000',
      scriptPubKey:descriptor.scriptPubKeyHex,witnessScript:descriptor.witnessScriptHex}],
    outputs:[{amountSats:'99000',scriptPubKey:rescue}]
  };
  const {digest}=createBitcoinWitnessV0Sighash({psbt:encodePsbtV2(intent),inputIndex:0});
  const partialSignatures=[priv(2),priv(3)].map(k=>({
    publicKey:pub(k),signature:Buffer.from(secp256k1.sign(digest,k,{prehash:false,lowS:true,format:'der'})).toString('hex')+'01'
  }));
  const psbt=encodePsbtV2({...intent,inputs:[{...intent.inputs[0],partialSignatures}]});
  const finalizer=createBitcoinFinalizerEvidence({psbt,descriptor,rescueScriptPubKey:rescue});
  const finalTransaction=createBitcoinFinalTransactionEvidence({psbt,descriptor,rescueScriptPubKey:rescue});
  const finalizerPath=join(dir,'finalizer.json'),finalPath=join(dir,'final.json'),output=join(dir,'proof.json');
  writeFileSync(finalizerPath,JSON.stringify(finalizer));
  writeFileSync(finalPath,JSON.stringify(finalTransaction));
  const answers={
    getrawtransaction:{txid:finalTransaction.txid,blockhash:'aa'.repeat(32),confirmations:6,in_active_chain:true},
    getblockheader:{hash:'aa'.repeat(32),height:300000,confirmations:6},
    getblockchaininfo:{chain:'signet',blocks:300005,bestblockhash:'bb'.repeat(32),initialblockdownload:false},
    getblockhash:'aa'.repeat(32),
    gettxout:{bestblock:'bb'.repeat(32),confirmations:6,value:'0.00099000',scriptPubKey:{hex:rescue}}
  };
  const answersPath=join(dir,'answers.json'),callsPath=join(dir,'calls.jsonl');
  writeFileSync(answersPath,JSON.stringify(answers));
  const mock=join(binaryDir,'bitcoin-cli');
  writeFileSync(mock,[
    '#!/usr/bin/env node',
    "const fs=require('node:fs');",
    "if(process.argv[2]!=='-signet')process.exit(9);",
    "const allowed=['getrawtransaction','getblockheader','getblockchaininfo','gettxout','getblockhash'];",
    "const method=process.argv[3];if(!allowed.includes(method))process.exit(11);",
    "fs.appendFileSync(process.env.OV_SIGNET_CALLS,JSON.stringify(process.argv.slice(2))+'\\n');",
    "const replies=JSON.parse(fs.readFileSync(process.env.OV_SIGNET_REPLIES,'utf8'));",
    "process.stdout.write(method==='getblockhash'?replies[method]:JSON.stringify(replies[method]));"
  ].join('\n')+'\n');
  chmodSync(mock,0o755);
  const env={...process.env,PATH:binaryDir+delimiter+(process.env.PATH??''),
    OV_SIGNET_REPLIES:answersPath,OV_SIGNET_CALLS:callsPath};
  const argv=['scripts/verify-bitcoin-signet-observation.js','--finalizer',finalizerPath,
    '--final-transaction',finalPath,'--output',output];
  return {dir,output,argv,env,callsPath,answers,answersPath};
}
test('operator Signet read-only observation CLI produces anchored proof with five allowed methods',()=>{
  const f=setup();try{
    const run=spawnSync(process.execPath,f.argv,{encoding:'utf8',env:f.env});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/BITCOIN_SIGNET_READONLY_OBSERVATION_OK/);
    const evidence=JSON.parse(readFileSync(f.output,'utf8'));
    assert.equal(evidence.observationSource,'bitcoin-core-rpc');
    assert.equal(evidence.publicSignetObservationProven,false);
    assert.equal(evidence.chainPromotionAuthority,false);
    assert.equal(evidence.immutableRescueOnChain,false);
    const calls=readFileSync(f.callsPath,'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(x=>x[1]),[
      'getrawtransaction','getblockheader','getblockchaininfo','getblockhash','gettxout','getblockchaininfo'
    ]);
    assert.ok(calls.every(x=>x[0]==='-signet'));
    const verification=spawnSync(process.execPath,[
      'scripts/verify-bitcoin-signet-artifact.js','--evidence',f.output,
      '--finalizer',f.argv[2],'--final-transaction',f.argv[4]
    ],{encoding:'utf8',env:f.env});
    assert.equal(verification.status,0,verification.stderr);
    assert.match(verification.stdout,/BITCOIN_SIGNET_ARTIFACT_VALID/);
    const repeated=spawnSync(process.execPath,f.argv,{encoding:'utf8',env:f.env});
    assert.notEqual(repeated.status,0);
    assert.equal(JSON.parse(readFileSync(f.output,'utf8')).sha256,evidence.sha256);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('operator Signet proof CLI refuses absent, ambiguous or active initial block download status',()=>{
  const f=setup();try{
    for(const status of [undefined, null, true, 0, 1, 'false', 'true']) {
      const replies=structuredClone(f.answers);
      if(status===undefined) delete replies.getblockchaininfo.initialblockdownload;
      else replies.getblockchaininfo.initialblockdownload=status;
      writeFileSync(f.answersPath,JSON.stringify(replies));
      const run=spawnSync(process.execPath,f.argv,{encoding:'utf8',env:f.env});
      assert.notEqual(run.status,0,'unexpected successful proof for initialblockdownload='+String(status));
      assert.match(run.stderr,/not a synchronized Signet node/);
      assert.equal(existsSync(f.output),false,'rejected observation must not save a proof');
    }
    writeFileSync(f.answersPath,JSON.stringify(f.answers));
    const valid=spawnSync(process.execPath,f.argv,{encoding:'utf8',env:f.env});
    assert.equal(valid.status,0,valid.stderr);
    assert.equal(existsSync(f.output),true);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('operator Signet proof CLI refuses spoofed chain history, invalid fees and secret-bearing flags',()=>{
  const f=setup();try{
    f.answers.getblockhash='cc'.repeat(32);
    writeFileSync(f.answersPath,JSON.stringify(f.answers));
    let run=spawnSync(process.execPath,f.argv,{encoding:'utf8',env:f.env});
    assert.notEqual(run.status,0);
    assert.match(run.stderr,/not on the active chain/);
    assert.equal(existsSync(f.output),false);
    f.answers.getblockhash='aa'.repeat(32);
    f.answers.gettxout.value='0.00098000';
    writeFileSync(f.answersPath,JSON.stringify(f.answers));
    run=spawnSync(process.execPath,f.argv,{encoding:'utf8',env:f.env});
    assert.notEqual(run.status,0);
    assert.match(run.stderr,/amount does not match/);
    assert.equal(existsSync(f.output),false);
    for(const flag of ['--wallet','--seed','--rpc-password','--broadcast','--private-key']) {
      run=spawnSync(process.execPath,[...f.argv,flag,'forbidden'],{encoding:'utf8',env:f.env});
      assert.notEqual(run.status,0);
      assert.match(run.stderr,/unsafe Bitcoin Signet proof option/);
    }
    assert.equal(existsSync(f.output),false);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('operator Signet read-only CLI rejects UTXO-tip mismatch, depth drift and malformed Core values without artifact',()=>{
  const f=setup();try{
    for (const edit of [
      a=>{a.gettxout.bestblock='22'.repeat(32);},
      a=>{a.gettxout.confirmations=5;},
      a=>{a.getblockheader.confirmations=5;},
      a=>{a.gettxout.value='0.000990001';},
      a=>{a.getblockchaininfo.chain='main';}
    ]) {
      const changed=structuredClone(f.answers);edit(changed);
      writeFileSync(f.answersPath,JSON.stringify(changed));
      const result=spawnSync(process.execPath,f.argv,{encoding:'utf8',env:f.env});
      assert.notEqual(result.status,0,JSON.stringify(changed));
      assert.equal(existsSync(f.output),false);
    }
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
