import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  encodePsbtV2, decodePsbtV2, createBitcoinWitnessV0Sighash
} from '../src/chains/bitcoin/psbt-v2.js';

// Synthetic offline codec fixtures: no wallet keys, signing or network access.
function fixture(locktime = 840000) {
  const witnessScript = '51';
  return encodePsbtV2({
    fallbackLocktime: locktime,
    inputs: [{
      txid: 'ab'.repeat(32), vout: 7, sequence: 144, amountSats: '100000',
      witnessScript,
      scriptPubKey: '0020' + createHash('sha256')
        .update(Buffer.from(witnessScript, 'hex')).digest('hex')
    }],
    outputs: [{ amountSats: '99000', scriptPubKey: '0014' + '11'.repeat(20) }]
  });
}

// Work at map boundaries rather than matching byte patterns inside values.
// This fixture uses only one-byte CompactSize lengths; assert that assumption.
function mapsOf(bytes) {
  let offset = 5;
  const maps = [];
  while (offset < bytes.length) {
    const entries = [];
    while (bytes[offset] !== 0) {
      const keyLength = bytes[offset++];
      assert.ok(keyLength > 0 && keyLength < 0xfd);
      const key = bytes.subarray(offset, offset + keyLength);
      offset += keyLength;
      const valueLength = bytes[offset++];
      assert.ok(valueLength < 0xfd);
      const value = bytes.subarray(offset, offset + valueLength);
      offset += valueLength;
      assert.equal(value.length, valueLength);
      entries.push({ key, value });
    }
    offset++;
    maps.push(entries);
  }
  assert.equal(offset, bytes.length);
  assert.equal(maps.length, 3);
  return maps;
}

function wire(maps) {
  return Buffer.concat([
    Buffer.from('70736274ff', 'hex'),
    ...maps.flatMap(entries => [
      ...entries.flatMap(({ key, value }) => [
        Buffer.from([key.length]), key, Buffer.from([value.length]), value
      ]),
      Buffer.from([0])
    ])
  ]);
}

const fields = [
  [0, 0xfb, 'global version'], [0, 0x02, 'transaction version'],
  [0, 0x03, 'fallback locktime'], [0, 0x04, 'input count'],
  [0, 0x05, 'output count'], [0, 0x06, 'transaction modifiable'],
  [1, 0x01, 'witness UTXO'], [1, 0x03, 'sighash type'],
  [1, 0x05, 'witness script'], [1, 0x0e, 'previous txid'],
  [1, 0x0f, 'output index'], [1, 0x10, 'sequence'],
  [2, 0x03, 'output amount'], [2, 0x04, 'output script']
];

for (const [mapIndex, type, label] of fields) {
  test('PSBT singleton rejects key data: ' + label, () => {
    for (const mode of ['replace', 'before', 'after']) {
      const maps = mapsOf(fixture());
      const entries = maps[mapIndex];
      const index = entries.findIndex(entry => entry.key[0] === type);
      assert.notEqual(index, -1);
      const canonical = entries[index];
      const malformed = {
        key: Buffer.concat([canonical.key, Buffer.from([0x42])]),
        value: canonical.value
      };
      const replacements = mode === 'replace' ? [malformed]
        : mode === 'before' ? [malformed, canonical] : [canonical, malformed];
      entries.splice(index, 1, ...replacements);
      assert.throws(() => decodePsbtV2(wire(maps)), /must not contain key data/, mode);
    }
  });
}

test('PSBT fallback locktime preserves nonzero values and omitted-field semantics in sighash', () => {
  const encoded = fixture();
  assert.equal(decodePsbtV2(encoded).fallbackLocktime, 840000);
  const maps = mapsOf(encoded);
  maps[0] = maps[0].filter(entry => entry.key[0] !== 0x03);
  const omitted = wire(maps);
  assert.equal(decodePsbtV2(omitted).fallbackLocktime, 0);
  const digest = psbt => createBitcoinWitnessV0Sighash({ psbt, inputIndex: 0 }).digest;
  assert.deepEqual(digest(omitted), digest(fixture(0)));
  assert.notDeepEqual(digest(encoded), digest(omitted));
});

test('PSBT singleton validation still permits unknown keyed extensions in every map', () => {
  const encoded = fixture();
  const maps = mapsOf(encoded);
  for (const entries of maps) {
    entries.push({ key: Buffer.from([0x70, 0x42]), value: Buffer.from([0x99]) });
    entries.sort((a, b) => Buffer.compare(a.key, b.key));
  }
  const extended = wire(maps);
  const decoded = decodePsbtV2(extended);
  assert.equal(decoded.canonicalMaps, true);
  assert.equal(decoded.fallbackLocktime, 840000);
  assert.deepEqual(decoded.inputs, decodePsbtV2(encoded).inputs);
  assert.deepEqual(decoded.outputs, decodePsbtV2(encoded).outputs);
  assert.deepEqual(
    createBitcoinWitnessV0Sighash({ psbt: extended, inputIndex: 0 }).digest,
    createBitcoinWitnessV0Sighash({ psbt: encoded, inputIndex: 0 }).digest
  );
});
