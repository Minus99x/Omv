import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodePsbtV2, decodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';

// Offline codec fixtures only: no private keys, signatures, RPC or broadcasts.
const witnessScript = '51';
const scriptPubKey = '0020' + createHash('sha256')
  .update(Buffer.from(witnessScript, 'hex')).digest('hex');
const input = (txid, vout = 0, sequence = 144) => ({
  txid, vout, sequence, amountSats: '100000', scriptPubKey, witnessScript
});
const intent = inputs => ({
  txVersion: 2, fallbackLocktime: 0, txModifiable: 0, inputs,
  outputs: [{ amountSats: '99000', scriptPubKey: '0014' + '11'.repeat(20) }]
});

test('PSBTv2 encoder rejects a duplicate outpoint despite different sequences', () => {
  const txid = 'ab'.repeat(32);
  assert.throws(
    () => encodePsbtV2(intent([input(txid, 0, 144), input(txid, 0, 145)])),
    /duplicate input outpoint/
  );
});

test('PSBTv2 encoder rejects duplicate outpoints with mixed-case txids', () => {
  const txid = 'ab'.repeat(32);
  assert.throws(
    () => encodePsbtV2(intent([input(txid, 1), input(txid.toUpperCase(), 1)])),
    /duplicate input outpoint/
  );
});

test('PSBTv2 decoder rejects duplicate outpoints forged in otherwise valid input maps', () => {
  const first = 'ab'.repeat(32);
  const second = 'cd'.repeat(32);
  const encoded = Buffer.from(encodePsbtV2(intent([input(first), input(second)])));
  const oldTxid = Buffer.from(second, 'hex').reverse();
  const newTxid = Buffer.from(first, 'hex').reverse();
  const offset = encoded.lastIndexOf(oldTxid);
  assert.notEqual(offset, -1, 'second input outpoint must exist in encoded PSBT');
  newTxid.copy(encoded, offset);
  assert.throws(() => decodePsbtV2(encoded), /duplicate input outpoint/);
});

test('PSBTv2 permits distinct vouts from one txid and distinct txids at one vout', () => {
  const a = 'ab'.repeat(32);
  const b = 'cd'.repeat(32);
  for (const inputs of [
    [input(a, 0), input(a, 1)],
    [input(a, 0), input(b, 0)]
  ]) {
    const decoded = decodePsbtV2(encodePsbtV2(intent(inputs)));
    assert.equal(decoded.inputs.length, 2);
    assert.equal(decoded.inputs[0].vout, 0);
  }
});

test('PSBTv2 sequence keys reject extra key data instead of silently defaulting', () => {
  const encoded = encodePsbtV2(intent([input('ab'.repeat(32))]));
  const field = Buffer.from('01100490000000', 'hex');
  const offset = encoded.indexOf(field);
  assert.notEqual(offset, -1);
  assert.equal(encoded.lastIndexOf(field), offset, 'fixture sequence field is unique');
  const malformed = Buffer.from('0210000490000000', 'hex');
  const before = encoded.subarray(0, offset);
  const after = encoded.subarray(offset + field.length);
  for (const replacement of [malformed, Buffer.concat([field, malformed])]) {
    assert.throws(() => decodePsbtV2(Buffer.concat([before, replacement, after])),
      /sequence field must not contain key data/);
  }
  assert.equal(decodePsbtV2(encoded).inputs[0].sequence, 144);
  assert.equal(decodePsbtV2(Buffer.concat([before, after])).inputs[0].sequence, 0xffffffff);
});

test('PSBTv2 sighash-type keys reject extra key data instead of bypassing SIGHASH_ALL validation', () => {
  const encoded = encodePsbtV2(intent([input('ab'.repeat(32))]));
  const field = Buffer.from('01030401000000', 'hex');
  const offset = encoded.indexOf(field);
  assert.notEqual(offset, -1);
  assert.equal(encoded.lastIndexOf(field), offset, 'fixture sighash field is unique');
  const before = encoded.subarray(0, offset);
  const after = encoded.subarray(offset + field.length);
  for (const value of ['01000000', '02000000']) {
    const malformed = Buffer.from('02030004' + value, 'hex');
    for (const replacement of [malformed, Buffer.concat([field, malformed])]) {
      assert.throws(() => decodePsbtV2(Buffer.concat([before, replacement, after])),
        /sighash-type field must not contain key data/);
    }
  }
  assert.equal(decodePsbtV2(encoded).inputs.length, 1);
  assert.equal(decodePsbtV2(Buffer.concat([before, after])).inputs.length, 1);
  const unsupported = Buffer.from('01030402000000', 'hex');
  assert.throws(() => decodePsbtV2(Buffer.concat([before, unsupported, after])), /must use SIGHASH_ALL/);
});

test('PSBTv2 transaction-modifiable keys reject extra key data instead of claiming frozen inputs and outputs', () => {
  const encoded = encodePsbtV2(intent([input('ab'.repeat(32))]));
  const field = Buffer.from('01060100', 'hex');
  const offset = encoded.indexOf(field);
  assert.notEqual(offset, -1);
  assert.equal(encoded.lastIndexOf(field), offset, 'fixture modifiable field is unique');
  const before = encoded.subarray(0, offset);
  const after = encoded.subarray(offset + field.length);
  for (const value of ['00', '01', '02', '03', '08']) {
    const malformed = Buffer.from('02060001' + value, 'hex');
    for (const replacement of [malformed, Buffer.concat([field, malformed])]) {
      assert.throws(() => decodePsbtV2(Buffer.concat([before, replacement, after])),
        /transaction-modifiable field must not contain key data/);
    }
  }
  assert.equal(decodePsbtV2(encoded).txModifiable, 0);
  assert.equal(decodePsbtV2(Buffer.concat([before, after])).txModifiable, 0);
  for (const value of ['01', '02', '03']) {
    const mutable = Buffer.from('010601' + value, 'hex');
    assert.throws(() => decodePsbtV2(Buffer.concat([before, mutable, after])), /must be frozen/);
  }
  const reservedBit = Buffer.from('01060108', 'hex');
  assert.throws(() => decodePsbtV2(Buffer.concat([before, reservedBit, after])), /three-bit field/);
});
