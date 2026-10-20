import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { verifyBitcoinFinalTransactionEvidence } from '../src/chains/bitcoin/transaction-finalizer.js';

const privateKey = n => Buffer.from(n.toString(16).padStart(64,'0'),'hex');
const pub = key => Buffer.from(secp256k1.getPublicKey(key,true)).toString('hex');
const signerKeys = [privateKey(2),privateKey(3)];
const rescue = `0014${'11'.repeat(20)}`;
const script = 'scripts/prepare-bitcoin-signet-offline-recovery.js';

function fixtures(signers = signerKeys) {
  const descriptor = createBitcoinRecoveryDescriptor({
    ownerKey:pub(privateKey(1)),
    contactKeys:signerKeys.map(pub),threshold:2,csvBlocks:144,network:'signet'
  });
  const intent = {
    txVersion:2,fallbackLocktime:0,txModifiable:0,
    inputs:[{txid:'ab'.repeat(32),vout:0,sequence:144,amountSats:'100000',
      scriptPubKey:descriptor.scriptPubKeyHex,witnessScript:descriptor.witnessScriptHex}],
    outputs:[{amountSats:'99000',scriptPubKey:rescue}]
  };
  const {digest} = createBitcoinWitnessV0Sighash({psbt:encodePsbtV2(intent),inputIndex:0});
  const partialSignatures = signers.map(key=>({
    publicKey:pub(key),
    signature:Buffer.from(secp256k1.sign(digest,key,{prehash:false,lowS:true,format:'der'})).toString('hex')+'01'
  }));
  const psbt=encodePsbtV2({...intent,inputs:[{...intent.inputs[0],partialSignatures}]}).toString('base64');
  return {descriptor,psbt};
}

function workspace(signers) {
  const dir=mkdtempSync(join(tmpdir(),'omegavault-signet-prep-'));
  const desc=join(dir,'descriptor.json'),psbt=join(dir,'signed.psbt'),output=join(dir,'finalized.json');
  const data=fixtures(signers);
  writeFileSync(desc,JSON.stringify(data.descriptor));
  writeFileSync(psbt,data.psbt+'\n');
  return {dir,desc,psbt,output,descriptor:data.descriptor,psbtBase64:data.psbt};
}
function args(f) {
  return ['--psbt',f.psbt,'--descriptor',f.desc,'--rescue-script-pubkey',rescue,
    '--expected-fee-sats','1000','--output',f.output];
}
function execute(argv) { return spawnSync(process.execPath,[script,...argv],{cwd:process.cwd(),encoding:'utf8'}); }

test('operator CLI creates deterministic frozen signed Signet recovery and verifiable evidence',()=>{
  const f=workspace();
  try {
    const result=execute(args(f));
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/BITCOIN_SIGNET_OFFLINE_PREPARATION_OK/);
    const artifact=JSON.parse(readFileSync(f.output,'utf8'));
    assert.equal(artifact.schema,'omegavault.bitcoin.signet-offline-recovery-preparation.v1');
    assert.equal(artifact.networkRef,'bitcoin:signet');
    assert.equal(artifact.transaction.txid,'0b01a21c7889debcbfb405d4bca27c1c3c3eb11979bbb516567ae0c99f517961');
    assert.equal(artifact.operatorExpectedFeeSats,'1000');
    assert.equal(artifact.transaction.finalizerEvidence.feeSats,'1000');
    assert.equal(artifact.transaction.finalizerEvidence.rescueAmountSats,'99000');
    assert.equal(artifact.readyForBroadcast,false);
    assert.equal(artifact.bitcoinCoreCrossCheckProven,false);
    assert.equal(artifact.signetExecutionProven,false);
    assert.equal(artifact.transaction.broadcastAuthorized,false);
    assert.deepEqual(
      verifyBitcoinFinalTransactionEvidence({
        evidence:artifact.finalTransactionEvidence,psbt:f.psbtBase64,descriptor:f.descriptor,rescueScriptPubKey:rescue
      }),{ok:true,errors:[]});
  } finally { rmSync(f.dir,{recursive:true,force:true}); }
});

test('operator CLI refuses incomplete signatures before creating an artifact',()=>{
  const f=workspace([signerKeys[0]]);
  try {
    const result=execute(args(f));
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/valid signature|threshold/i);
    assert.equal(existsSync(f.output),false);
  } finally { rmSync(f.dir,{recursive:true,force:true}); }
});

test('operator CLI rejects an unexpected rescue and mismatched expected fee without writing',()=>{
  const f=workspace();
  try {
    const wrongRescue=execute(args(f).map((v,i,array)=>array[i-1]==='--rescue-script-pubkey'?`0014${'22'.repeat(20)}`:v));
    assert.notEqual(wrongRescue.status,0);
    assert.match(wrongRescue.stderr,/rescue output/i);
    assert.equal(existsSync(f.output),false);
    const wrongFee=execute(args(f).map((v,i,array)=>array[i-1]==='--expected-fee-sats'?'999':v));
    assert.notEqual(wrongFee.status,0);
    assert.match(wrongFee.stderr,/fee does not match/i);
    assert.equal(existsSync(f.output),false);
  } finally { rmSync(f.dir,{recursive:true,force:true}); }
});

test('operator CLI refuses existing artifact overwrite and preserves its contents',()=>{
  const f=workspace();
  try {
    writeFileSync(f.output,'immutable-original');
    const result=execute(args(f));
    assert.notEqual(result.status,0);
    assert.equal(readFileSync(f.output,'utf8'),'immutable-original');
  } finally { rmSync(f.dir,{recursive:true,force:true}); }
});

test('operator CLI rejects secret-bearing flags and noncanonical fee parameters',()=>{
  const f=workspace();
  try {
    for(const flag of ['--seed','--private-key','--wallet','--rpc-password','--broadcast','--submit']){
      const result=execute([...args(f),flag,'forbidden']);
      assert.notEqual(result.status,0,flag);
      assert.equal(existsSync(f.output),false);
    }
    const wrongFee=execute(args(f).map((v,i,array)=>array[i-1]==='--expected-fee-sats'?'01000':v));
    assert.notEqual(wrongFee.status,0);
    assert.match(wrongFee.stderr,/canonical non-negative/);
    assert.equal(existsSync(f.output),false);
  } finally { rmSync(f.dir,{recursive:true,force:true}); }
});

function coreObservations(tx) {
  return {
    schema:'omegavault.bitcoin.core-cross-check-observations.v1',
    node:{chain:'signet',version:310100,subversion:'/Satoshi:31.1.0/',protocolVersion:70016},
    decodedTransaction:{
      txid:tx.txid,hash:tx.wtxid,size:tx.bytes,vsize:tx.virtualBytes,weight:tx.weight,
      version:2,locktime:0,
      vin:tx.finalizerEvidence.inputs.map((input,i)=>({
        txid:input.txid,vout:input.vout,sequence:input.sequence,
        scriptSig:{hex:''},txinwitness:tx.witnesses[i].stackItems
      })),
      vout:tx.finalizerEvidence.outputs.map((output,i)=>({
        value:(Number(output.amountSats)/100000000).toFixed(8),
        n:i,scriptPubKey:{hex:output.scriptPubKey}
      }))
    },
    mempoolResult:{
      txid:tx.txid,wtxid:tx.wtxid,allowed:true,vsize:tx.virtualBytes,
      fees:{base:'0.00001000','effective-feerate':'0.00005000','effective-includes':[tx.wtxid]}
    }
  };
}

test('offline preparation can feed the existing read-only Bitcoin Core import CLI directly',()=>{
  const f=workspace();
  try {
    const prepared=execute(args(f));
    assert.equal(prepared.status,0,prepared.stderr);
    const artifact=JSON.parse(readFileSync(f.output,'utf8'));
    const observations=join(f.dir,'core-observations.json');
    const coreOutput=join(f.dir,'core-evidence.json');
    writeFileSync(observations,JSON.stringify(coreObservations(artifact.transaction)));
    const imported=spawnSync(process.execPath,[
      'scripts/verify-bitcoin-core-cross-check.js',
      '--transaction',f.output,'--observations',observations,'--output',coreOutput
    ],{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(imported.status,0,imported.stderr);
    const evidence=JSON.parse(readFileSync(coreOutput,'utf8'));
    assert.equal(evidence.txid,artifact.transaction.txid);
    assert.equal(evidence.observationSource,'imported-json');
    assert.equal(evidence.bitcoinCoreCrossCheckProven,false);
    assert.equal(evidence.broadcastAuthorized,false);
    assert.equal(evidence.signetExecutionProven,false);
  } finally { rmSync(f.dir,{recursive:true,force:true}); }
});

test('Core import rejects tampered prepared artifacts without creating evidence',()=>{
  const f=workspace();
  try {
    assert.equal(execute(args(f)).status,0);
    const artifact=JSON.parse(readFileSync(f.output,'utf8'));
    const observations=join(f.dir,'core-observations.json'),coreOutput=join(f.dir,'core-evidence.json');
    writeFileSync(observations,JSON.stringify(coreObservations(artifact.transaction)));
    const importArgs=[
      'scripts/verify-bitcoin-core-cross-check.js','--transaction',f.output,
      '--observations',observations,'--output',coreOutput
    ];
    for(const edit of [
      a=>{a.readyForBroadcast=true;},
      a=>{a.operatorExpectedFeeSats='999';},
      a=>{a.finalTransactionEvidence.txid='00'.repeat(32);},
      a=>{a.transaction.rawHex=a.transaction.rawHex.slice(0,-2)+'00';}
    ]){
      const modified=structuredClone(artifact);
      edit(modified);
      writeFileSync(f.output,JSON.stringify(modified));
      const result=spawnSync(process.execPath,importArgs,{cwd:process.cwd(),encoding:'utf8'});
      assert.notEqual(result.status,0);
      assert.equal(existsSync(coreOutput),false);
    }
  } finally { rmSync(f.dir,{recursive:true,force:true}); }
});
