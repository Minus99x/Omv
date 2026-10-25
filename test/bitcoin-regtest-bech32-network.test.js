import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';

// Independently checked against BIP173 Bech32 checksum calculation and the
// network HRPs in bitcoinjs-lib's MIT-licensed networks configuration.
// Public Bitcoin Core 31.1 synthetic descriptor fixture: no secrets, RPC, or broadcasts.
const ownerKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const contactKeys = [
  '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
  '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
];
const baseline = {
  ownerKey, contactKeys, threshold: 2, csvBlocks: 144
};
const expectedScriptPubKey = '00204e2551c7281bcf56979fd65e4751e8c7ba678eb7caec1d088a04541d620c4fba';

const expected = {
  mainnet: 'bc1qfcj4r3egr084d9ul6e0yw50gc7ax0r4hetkp6zy2q32p6csvf7aq4vugp2',
  testnet: 'tb1qfcj4r3egr084d9ul6e0yw50gc7ax0r4hetkp6zy2q32p6csvf7aqzy28m9',
  signet: 'tb1qfcj4r3egr084d9ul6e0yw50gc7ax0r4hetkp6zy2q32p6csvf7aqzy28m9',
  regtest: 'bcrt1qfcj4r3egr084d9ul6e0yw50gc7ax0r4hetkp6zy2q32p6csvf7aq0aqpwl'
};

for (const [network, address] of Object.entries(expected)) {
  test(`Bitcoin P2WSH Bech32 uses ${network} HRP with the correct network-specific checksum`, () => {
    const descriptor = createBitcoinRecoveryDescriptor({ ...baseline, network });
    assert.equal(descriptor.network, network);
    assert.equal(descriptor.address, address);
    assert.equal(descriptor.scriptPubKeyHex, expectedScriptPubKey,
      'HRP change must not alter the underlying spending script');
    assert.equal(descriptor.semantics.immutableRescueOutput, false,
      'Address correction must not promote Bitcoin recovery safety claims');
  });
}

test('regtest addresses differ from signet even for identical witness scripts', () => {
  const regtest = createBitcoinRecoveryDescriptor({ ...baseline, network: 'regtest' });
  const signet = createBitcoinRecoveryDescriptor({ ...baseline, network: 'signet' });
  assert.equal(regtest.scriptPubKeyHex, signet.scriptPubKeyHex);
  assert.equal(regtest.witnessScriptHex, signet.witnessScriptHex);
  assert.notEqual(regtest.address, signet.address);
  assert.match(regtest.address, /^bcrt1q/);
  assert.match(signet.address, /^tb1q/);
});
