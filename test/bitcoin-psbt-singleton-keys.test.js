import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  encodePsbtV2, decodePsbtV2, createBitcoinWitnessV0Sighash,
  verifyPsbtV2RecoverySignature, verifyPsbtV2RecoveryThreshold,
  finalizePsbtV2RecoveryTransaction
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

function requiredLocktimeEntry(type, value, extraKeyData = false) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return { key: Buffer.from(extraKeyData ? [type, 0x42] : [type]), value: bytes };
}

for (const [type, value, label] of [
  [0x11, 1700000000, 'time'], [0x12, 850000, 'height']
]) {
  test('PSBT rejects unsupported required ' + label + ' locktime with or without fallback', () => {
    for (const fallback of [true, false]) {
      for (const extraKeyData of [false, true]) {
        const maps = mapsOf(fixture());
        if (!fallback) maps[0] = maps[0].filter(entry => entry.key[0] !== 0x03);
        maps[1].push(requiredLocktimeEntry(type, value, extraKeyData));
        assert.throws(() => decodePsbtV2(wire(maps)), /input 0 required locktime fields are unsupported/);
      }
    }
  });

  test('PSBT rejects malformed required ' + label + ' locktime values', () => {
    for (const valueBytes of [Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(4), Buffer.alloc(5)]) {
      const maps = mapsOf(fixture());
      maps[1].push({ key: Buffer.from([type]), value: valueBytes });
      assert.throws(() => decodePsbtV2(wire(maps)), /required locktime fields are unsupported/);
    }
  });
}

test('PSBT rejects combined required locktime types on a later input', () => {
  const maps = mapsOf(fixture());
  maps[0].find(entry => entry.key[0] === 0x04).value = Buffer.from([2]);
  const second = maps[1].map(entry => ({
    key: Buffer.from(entry.key), value: Buffer.from(entry.value)
  }));
  second.find(entry => entry.key[0] === 0x0e).value = Buffer.alloc(32, 0xcd);
  second.push(requiredLocktimeEntry(0x11, 1700000000), requiredLocktimeEntry(0x12, 850000));
  maps.splice(2, 0, second);
  assert.throws(() => decodePsbtV2(wire(maps)), /input 1 required locktime fields are unsupported/);
});

test('PSBT required locktime cannot bypass recovery entry points through bytes or decoded objects', () => {
  const clean = fixture();
  const maps = mapsOf(clean);
  maps[1].push(requiredLocktimeEntry(0x12, 850000));
  const encoded = wire(maps);
  const forged = { ...decodePsbtV2(clean), base64: encoded.toString('base64') };
  for (const psbt of [encoded, encoded.toString('base64'), forged]) {
    for (const invoke of [
      () => createBitcoinWitnessV0Sighash({ psbt, inputIndex: 0 }),
      () => verifyPsbtV2RecoverySignature({ psbt, inputIndex: 0 }),
      () => verifyPsbtV2RecoveryThreshold({ psbt, inputIndex: 0 }),
      () => finalizePsbtV2RecoveryTransaction({ psbt })
    ]) {
      // Require the locktime error before descriptor/key/threshold handling.
      assert.throws(invoke, /required locktime fields are unsupported/);
    }
  }
});

for (const [type, label] of [[0x07, 'scriptSig'], [0x08, 'scriptWitness']]) {
  test('PSBT rejects existing final ' + label + ' including empty and malformed values', () => {
    for (const value of [Buffer.alloc(0), Buffer.from('00', 'hex'), Buffer.from('010151', 'hex'), Buffer.from('ff', 'hex')]) {
      const maps = mapsOf(fixture());
      maps[1].push({ key: Buffer.from([type]), value });
      maps[1].sort((a, b) => Buffer.compare(a.key, b.key));
      assert.throws(() => decodePsbtV2(wire(maps)), /input 0 final script fields are unsupported/);
    }
  });

  test('PSBT rejects final ' + label + ' with forbidden key data', () => {
    const maps = mapsOf(fixture());
    maps[1].push({ key: Buffer.from([type, 0x42]), value: Buffer.alloc(0) });
    assert.throws(() => decodePsbtV2(wire(maps)), /final script fields are unsupported/);
  });

  test('PSBT final ' + label + ' cannot bypass recovery entry points', () => {
    const clean = fixture();
    const maps = mapsOf(clean);
    maps[1].push({ key: Buffer.from([type]), value: Buffer.from('00', 'hex') });
    const encoded = wire(maps);
    const forged = { ...decodePsbtV2(clean), base64: encoded.toString('base64') };
    for (const psbt of [encoded, encoded.toString('base64'), forged]) {
      for (const invoke of [
        () => createBitcoinWitnessV0Sighash({ psbt, inputIndex: 0 }),
        () => verifyPsbtV2RecoverySignature({ psbt, inputIndex: 0 }),
        () => verifyPsbtV2RecoveryThreshold({ psbt, inputIndex: 0 }),
        () => finalizePsbtV2RecoveryTransaction({ psbt })
      ]) assert.throws(invoke, /final script fields are unsupported/);
    }
  });
}

test('PSBT rejects combined final script fields on a later input', () => {
  const maps = mapsOf(fixture());
  maps[0].find(entry => entry.key[0] === 0x04).value = Buffer.from([2]);
  const second = maps[1].map(entry => ({
    key: Buffer.from(entry.key), value: Buffer.from(entry.value)
  }));
  second.find(entry => entry.key[0] === 0x0e).value = Buffer.alloc(32, 0xcd);
  second.push(
    { key: Buffer.from([0x07]), value: Buffer.alloc(0) },
    { key: Buffer.from([0x08]), value: Buffer.from('010151', 'hex') }
  );
  maps.splice(2, 0, second);
  assert.throws(() => decodePsbtV2(wire(maps)), /input 1 final script fields are unsupported/);
});
