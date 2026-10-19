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
  const psbt=encodePsbtV2({...intent,inputs:[{...intent.inputs[0],partialSignatures}]});
  return {descriptor,psbt};
}

function workspace(signers) {
  const dir=mkdtempSync(join(tmpdir(),'omegavault-signet-prep-'));
  const desc=join(dir,'descriptor.json'),psbt=join(dir,'signed.psbt'),output=join(dir,'finalized.json');
  const data=fixtures(signers);
  writeFileSync(desc,JSON.stringify(data.descriptor));
  writeFileSync(psbt,data.psbt+'\n');
  return {dir,desc,psbt,output,...data};
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
        evidence:artifact.finalTransactionEvidence,psbt:f.psbt,descriptor:f.descriptor,rescueScriptPubKey:rescue
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
