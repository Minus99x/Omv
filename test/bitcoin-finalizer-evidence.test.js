import test from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { createBitcoinFinalizerEvidence, verifyBitcoinFinalizerEvidence } from '../src/chains/bitcoin/finalizer-evidence.js';

const privateKey = value => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
const publicKey = key => Buffer.from(secp256k1.getPublicKey(key, true)).toString('hex');
const ownerPrivateKey = privateKey(1);
const contactPrivateKeyA = privateKey(2);
const contactPrivateKeyB = privateKey(3);
const outsiderPrivateKey = privateKey(4);
const ownerKey = publicKey(ownerPrivateKey);
const contactKeyA = publicKey(contactPrivateKeyA);
const contactKeyB = publicKey(contactPrivateKeyB);
const outsiderKey = publicKey(outsiderPrivateKey);
const rescueScriptPubKey = `0014${'11'.repeat(20)}`;

const descriptor = createBitcoinRecoveryDescriptor({
  ownerKey,
  contactKeys:[contactKeyA, contactKeyB],
  threshold:2,
  csvBlocks:144,
  network:'signet'
});

function intent(overrides = {}) {
  return {
    txVersion:2,
    fallbackLocktime:0,
    txModifiable:0,
    inputs:[{
      txid:'ab'.repeat(32),
      vout:0,
      sequence:144,
      amountSats:'100000',
      scriptPubKey:descriptor.scriptPubKeyHex,
      witnessScript:descriptor.witnessScriptHex
    }],
    outputs:[{ amountSats:'99000', scriptPubKey:rescueScriptPubKey }],
    ...overrides
  };
}

function signedPsbt({ signers = [contactPrivateKeyA, contactPrivateKeyB], overrides = {} } = {}) {
  const base = intent(overrides);
  const unsigned = encodePsbtV2(base);
  const { digest } = createBitcoinWitnessV0Sighash({ psbt:unsigned, inputIndex:0 });
  const partialSignatures = signers.map(key => ({
    publicKey:publicKey(key),
    signature:`${Buffer.from(secp256k1.sign(digest, key, { prehash:false, lowS:true, format:'der' })).toString('hex')}01`
  }));
  return encodePsbtV2({
    ...base,
    inputs:[{ ...base.inputs[0], partialSignatures }]
  });
}

test('Bitcoin finalizer evidence binds frozen Signet PSBT, CSV, threshold, fee and rescue output', () => {
  const psbt = signedPsbt();
  const evidence = createBitcoinFinalizerEvidence({ psbt, descriptor, rescueScriptPubKey });
  assert.equal(evidence.schema, 'omegavault.bitcoin.finalizer-evidence.v1');
  assert.equal(evidence.chainId, 'bitcoin');
  assert.equal(evidence.networkRef, 'bitcoin:signet');
  assert.equal(evidence.inputs[0].thresholdReached, true);
  assert.equal(evidence.inputs[0].validSignerCount, 2);
  assert.equal(evidence.rescueAmountSats, '99000');
  assert.equal(evidence.feeSats, '1000');
  assert.equal(evidence.destinationCheckedByFinalizer, true);
  assert.equal(evidence.immutableRescueOnChain, false);
  assert.equal(evidence.broadcastAuthorized, false);
  assert.equal(evidence.signetExecutionProven, false);
  assert.match(evidence.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyBitcoinFinalizerEvidence({ evidence, psbt, descriptor, rescueScriptPubKey }), { ok:true, errors:[] });
});

test('Bitcoin finalizer evidence rejects incomplete recovery threshold', () => {
  const psbt = signedPsbt({ signers:[contactPrivateKeyA] });
  assert.throws(
    () => createBitcoinFinalizerEvidence({ psbt, descriptor, rescueScriptPubKey }),
    /valid signature.*2 required/i
  );
});

test('Bitcoin finalizer evidence rejects wrong rescue destination', () => {
  const psbt = signedPsbt();
  assert.throws(
    () => createBitcoinFinalizerEvidence({ psbt, descriptor, rescueScriptPubKey:`0014${'22'.repeat(20)}` }),
    /exactly one configured rescue output/i
  );
});

test('Bitcoin finalizer evidence rejects CSV sequence below policy', () => {
  const psbt = signedPsbt({ overrides:{
    inputs:[{
      ...intent().inputs[0],
      sequence:143
    }]
  }});
  assert.throws(
    () => createBitcoinFinalizerEvidence({ psbt, descriptor, rescueScriptPubKey }),
    /CSV policy/i
  );
});

test('Bitcoin finalizer evidence rejects unexpected recovery signer', () => {
  const psbt = signedPsbt({ signers:[contactPrivateKeyA, outsiderPrivateKey] });
  assert.throws(
    () => createBitcoinFinalizerEvidence({ psbt, descriptor, rescueScriptPubKey }),
    /unexpected recovery signer/i
  );
});

test('Bitcoin finalizer evidence rejects additional outputs in strict rescue mode', () => {
  const outputs = [
    { amountSats:'98000', scriptPubKey:rescueScriptPubKey },
    { amountSats:'1000', scriptPubKey:`0014${'22'.repeat(20)}` }
  ];
  const psbt = signedPsbt({ overrides:{ outputs } });
  assert.throws(
    () => createBitcoinFinalizerEvidence({ psbt, descriptor, rescueScriptPubKey }),
    /forbids additional outputs/i
  );
  const evidence = createBitcoinFinalizerEvidence({
    psbt,
    descriptor,
    rescueScriptPubKey,
    strictSingleRescueOutput:false
  });
  assert.equal(evidence.outputTotalSats, '99000');
});

test('tampered Bitcoin finalizer evidence fails closed', () => {
  const psbt = signedPsbt();
  const evidence = structuredClone(createBitcoinFinalizerEvidence({ psbt, descriptor, rescueScriptPubKey }));
  evidence.feeSats = '999';
  assert.equal(verifyBitcoinFinalizerEvidence({ evidence, psbt, descriptor, rescueScriptPubKey }).ok, false);
});
