import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeUintWord, encodeAddressWord, encodeRecoveryConstructor,
  makeDeploymentData, methodData, methodDataWithAddress, parseEther, toHexQuantity,
  decodeUintWord, decodeBoolWord, decodeAddressWord,
  maskImmutableReferences, runtimeBytecodeMatches
} from '../public/chains/evm-codec.js';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const DEST = '0x3333333333333333333333333333333333333333';

test('ABI words encode uints and Ethereum addresses', () => {
  assert.equal(encodeUintWord(128), `${'0'.repeat(62)}80`);
  assert.equal(encodeAddressWord(A), `${'0'.repeat(24)}${'11'.repeat(20)}`);
});

test('constructor encoder uses dynamic array offset and appends contacts', () => {
  const encoded = encodeRecoveryConstructor({ trustedContacts: [A, B], threshold: 2, inactivitySeconds: 60, rescueDestination: DEST });
  const words = encoded.match(/.{64}/g);
  assert.equal(words.length, 7);
  assert.equal(BigInt(`0x${words[0]}`), 128n);
  assert.equal(BigInt(`0x${words[1]}`), 2n);
  assert.equal(BigInt(`0x${words[2]}`), 60n);
  assert.equal(BigInt(`0x${words[4]}`), 2n);
});

test('Ethereum proof encoder caps contacts independently of Core policy model', () => {
  const contacts = Array.from({ length: 33 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
  assert.throws(() => encodeRecoveryConstructor({ trustedContacts: contacts, threshold: 1, inactivitySeconds: 60, rescueDestination: DEST }), /at most 32/);
});

test('deployment data appends constructor encoding to bytecode', () => {
  const data = makeDeploymentData('60006000', { trustedContacts: [A], threshold: 1, inactivitySeconds: 15, rescueDestination: DEST });
  assert.ok(data.startsWith('0x60006000'));
  assert.equal((data.length - 2) % 2, 0);
});

test('method identifiers encode zero-arg and address-arg calls', () => {
  assert.equal(methodData({ 'heartbeat()': '3defb962' }, 'heartbeat()'), '0x3defb962');
  assert.equal(methodDataWithAddress({ 'isTrustedContact(address)': '12345678' }, 'isTrustedContact(address)', A), `0x12345678${encodeAddressWord(A)}`);
  assert.throws(() => methodData({}, 'heartbeat()'), /selector missing/);
});

test('ETH decimal parsing is exact with bigint', () => {
  assert.equal(parseEther('1'), 10n ** 18n);
  assert.equal(parseEther('0.001'), 10n ** 15n);
  assert.equal(toHexQuantity(parseEther('0.001')), '0x38d7ea4c68000');
});

test('ABI result decoders read primitive words', () => {
  assert.equal(decodeUintWord(`0x${encodeUintWord(60)}`), 60n);
  assert.equal(decodeBoolWord(`0x${encodeUintWord(1)}`), true);
  assert.equal(decodeAddressWord(`0x${encodeAddressWord(A)}`), A);
});

test('runtime verification masks only compiler-declared immutable byte ranges', () => {
  const compiled = '0x6000000061ff';
  const live = '0x60aabbcc61ff';
  const refs = { '1': [{ start: 1, length: 3 }] };
  assert.equal(maskImmutableReferences(live, refs), '0x6000000061ff');
  assert.equal(runtimeBytecodeMatches(compiled, live, refs), true);
  assert.equal(runtimeBytecodeMatches(compiled, '0x60aabbcc62ff', refs), false);
});
