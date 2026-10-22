import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash,encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { createBitcoinFinalizerEvidence } from '../src/chains/bitcoin/finalizer-evidence.js';
import { createBitcoinFinalTransactionEvidence } from '../src/chains/bitcoin/transaction-finalizer.js';
import { createBitcoinSignetObservationEvidence } from '../src/chains/bitcoin/signet-evidence.js';
const priv=n=>Buffer.from(n.toString(16).padStart(64,'0'),'hex');
const pub=k=>Buffer.from(secp256k1.getPublicKey(k,true)).toString('hex');
function fixture(){
  const descriptor=createBitcoinRecoveryDescriptor({
    ownerKey:pub(priv(1)),contactKeys:[pub(priv(2)),pub(priv(3))],
    threshold:2,csvBlocks:144,network:'signet'
  });
  const rescue='0014'+'11'.repeat(20);
  const intent={
    txVersion:2,txModifiable:0,fallbackLocktime:0,
    inputs:[{txid:'ab'.repeat(32),vout:0,sequence:144,amountSats:'100000',
      scriptPubKey:descriptor.scriptPubKeyHex,witnessScript:descriptor.witnessScriptHex}],
    outputs:[{amountSats:'99000',scriptPubKey:rescue}]
  };
  const {digest}=createBitcoinWitnessV0Sighash({psbt:encodePsbtV2(intent),inputIndex:0});
  const partialSignatures=[priv(2),priv(3)].map(k=>({
    publicKey:pub(k),
    signature:Buffer.from(secp256k1.sign(digest,k,{prehash:false,lowS:true,format:'der'})).toString('hex')+'01'
  }));
  const psbt=encodePsbtV2({...intent,inputs:[{...intent.inputs[0],partialSignatures}]});
  const finalizerEvidence=createBitcoinFinalizerEvidence({psbt,descriptor,rescueScriptPubKey:rescue});
  const finalTransactionEvidence=createBitcoinFinalTransactionEvidence({psbt,descriptor,rescueScriptPubKey:rescue});
  const hash='aa'.repeat(32),transactionId=finalTransactionEvidence.txid;
  const transaction={transactionId,networkRef:'bitcoin:signet',confirmations:6,
    blockHash:hash,blockHeight:300000,observedAt:'2026-10-22T18:00:00Z'};
  const chainTip={networkRef:'bitcoin:signet',blockHash:'bb'.repeat(32),
    blockHeight:300005,observedAt:'2026-10-22T18:01:00Z'};
  const rescueUtxo={txid:transactionId,vout:0,amountSats:'99000',
    scriptPubKey:rescue,unspent:true};
  const evidence=createBitcoinSignetObservationEvidence({
    finalizerEvidence,finalTransactionEvidence,transaction,chainTip,rescueUtxo
  });
  return {evidence,finalizerEvidence,finalTransactionEvidence};
}
test('offline verifier validates real created artifact and rejects receipt mutations',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ov-signet-artifact-'));
  try {
    const data=fixture();
    const paths=Object.fromEntries(Object.keys(data).map(key=>[key,join(dir,key+'.json')]));
    for(const [key,val] of Object.entries(data))writeFileSync(paths[key],JSON.stringify(val));
    const argv=['scripts/verify-bitcoin-signet-artifact.js',
      '--evidence',paths.evidence,'--finalizer',paths.finalizerEvidence,
      '--final-transaction',paths.finalTransactionEvidence];
    function execute(extra=[]){return spawnSync(process.execPath,[...argv,...extra],{encoding:'utf8'});}
    const valid=execute();
    assert.equal(valid.status,0,valid.stderr);
    assert.match(valid.stdout,/BITCOIN_SIGNET_ARTIFACT_VALID/);
    for(const mutate of [
      value=>{value.publicSignetObservationProven=true;},
      value=>{value.rescueUtxo.amountSats='1';},
      value=>{value.sha256='00'.repeat(32);}
    ]){
      const changed=structuredClone(data.evidence);mutate(changed);
      writeFileSync(paths.evidence,JSON.stringify(changed));
      const result=execute();
      assert.notEqual(result.status,0);
      assert.match(result.stderr,/BITCOIN_SIGNET_ARTIFACT_INVALID/);
    }
    // The preceding loop intentionally corrupts this file; start the
    // freshness check from a valid, self-consistent receipt.
    writeFileSync(paths.evidence,JSON.stringify(data.evidence));
    const stale=execute(['--max-age-seconds','0']);
    assert.notEqual(stale.status,0);
    assert.match(stale.stderr,/maximum age|future/);
    assert.equal(execute(['--max-age-seconds','1.5']).status!==0,true);
    assert.equal(execute(['--max-age-seconds','-1']).status!==0,true);
    assert.equal(execute(['--max-age-seconds','9007199254741']).status!==0,true);
    for(const option of ['--wallet','--private-key','--seed','--broadcast']){
      assert.notEqual(execute([option,'forbidden']).status,0);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
