import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodePsbtV2, decodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';

// Strictly synthetic PSBTv2 wire fixtures. No signing, secrets, or network calls.
const MAX_MONEY = 21_000_000n * 100_000_000n;
const witnessScript = '51';
const scriptPubKey = '0020' +
  createHash('sha256').update(Buffer.from(witnessScript, 'hex')).digest('hex');

function input(txid, amountSats) {
  return {txid, vout:0, sequence:144, amountSats:String(amountSats), scriptPubKey, witnessScript};
}
function intent(inputs=[input('ab'.repeat(32),100000n)], outputSats=99000n) {
  return {
    txVersion:2, fallbackLocktime:0, txModifiable:0, inputs,
    outputs:[{amountSats:String(outputSats), scriptPubKey:'0014'+'11'.repeat(20)}]
  };
}
function le64(number) {
  const b=Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(number));
  return b;
}
function rewriteAmount(buffer, before, after, ordinal=0) {
  const mutated=Buffer.from(buffer);
  const marker=le64(before);
  let offset=-1;
  for(let index=0;index<=ordinal;index++) offset=mutated.indexOf(marker,offset+1);
  assert.notEqual(offset,-1,'amount marker exists in the encoded fixture');
  le64(after).copy(mutated,offset);
  return mutated;
}
function replaceGlobalCount(buffer, field, count) {
  const mutated=Buffer.from(buffer);
  const marker=Buffer.from([0x01,field,0x01,0x01]);
  const offset=mutated.indexOf(marker);
  assert.notEqual(offset,-1,'canonical global input/output count marker exists');
  mutated[offset+3]=count;
  return mutated;
}

test('PSBTv2 parser rejects oversized witness UTXO amounts forged into valid wire maps', () => {
  const encoded=encodePsbtV2(intent());
  const forged=rewriteAmount(encoded,100000n,MAX_MONEY+1n);
  assert.throws(()=>decodePsbtV2(forged),/witness UTXO amount exceeds Bitcoin MAX_MONEY/);
  assert.equal(decodePsbtV2(encoded).inputs[0].amountSats,'100000');
});

test('PSBTv2 parser rejects wire outputs exceeding the aggregate input amount', () => {
  const encoded=encodePsbtV2(intent());
  const forged=rewriteAmount(encoded,99000n,100001n);
  assert.throws(()=>decodePsbtV2(forged),/outputs exceed input value/);
  assert.equal(decodePsbtV2(encoded).outputs[0].amountSats,'99000');
});

test('PSBTv2 encode and decode reject inputs exceeding total Bitcoin monetary supply', () => {
  const a='ab'.repeat(32),b='cd'.repeat(32);
  const legal=intent([input(a,10_000_000n*100_000_000n),input(b,10_000_000n*100_000_000n)],1000n);
  const wire=encodePsbtV2(legal);
  assert.equal(decodePsbtV2(wire).inputs.length,2);
  assert.throws(()=>encodePsbtV2(intent([
    input(a,12_000_000n*100_000_000n),input(b,10_000_000n*100_000_000n)
  ],1000n)),/aggregate value exceeds Bitcoin MAX_MONEY/);
  const mutated=rewriteAmount(wire,10_000_000n*100_000_000n,12_000_000n*100_000_000n);
  assert.throws(()=>decodePsbtV2(mutated),/aggregate value exceeds Bitcoin MAX_MONEY/);
});

test('PSBTv2 parser rejects wire count fields encoding zero inputs or zero outputs',()=>{
  const wire=encodePsbtV2(intent());
  assert.throws(()=>decodePsbtV2(replaceGlobalCount(wire,0x04,0)),/at least one input and output/);
  assert.throws(()=>decodePsbtV2(replaceGlobalCount(wire,0x05,0)),/at least one input and output/);
  assert.equal(decodePsbtV2(wire).inputs.length,1);
  assert.equal(decodePsbtV2(wire).outputs.length,1);
});
