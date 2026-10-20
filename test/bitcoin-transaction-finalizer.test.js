import test from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, decodePsbtV2, encodePsbtV2, finalizePsbtV2RecoveryTransaction, verifyPsbtV2RecoverySignature, verifyPsbtV2RecoveryThreshold } from '../src/chains/bitcoin/psbt-v2.js';
import { createBitcoinFinalizerEvidence } from '../src/chains/bitcoin/finalizer-evidence.js';
import {
  createBitcoinFinalTransactionEvidence,
  extractBitcoinRecoveryTransaction,
  verifyBitcoinFinalTransactionEvidence
} from '../src/chains/bitcoin/transaction-finalizer.js';

const privateKey = value => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
const publicKey = key => Buffer.from(secp256k1.getPublicKey(key, true)).toString('hex');
const ownerPrivateKey = privateKey(1);
const contactPrivateKeyA = privateKey(2);
const contactPrivateKeyB = privateKey(3);
const outsiderPrivateKey = privateKey(4);
const ownerKey = publicKey(ownerPrivateKey);
const contactKeyA = publicKey(contactPrivateKeyA);
const contactKeyB = publicKey(contactPrivateKeyB);
const rescueScriptPubKey = `0014${'11'.repeat(20)}`;

const descriptor = createBitcoinRecoveryDescriptor({
  ownerKey,
  contactKeys:[contactKeyB, contactKeyA],
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

function signedPsbt({ signers = [contactPrivateKeyB, contactPrivateKeyA], overrides = {} } = {}) {
  const base = intent(overrides);
  const unsigned = encodePsbtV2(base);
  const { digest } = createBitcoinWitnessV0Sighash({ psbt:unsigned, inputIndex:0 });
  const partialSignatures = signers.map(key => ({
    publicKey:publicKey(key),
    signature:`${Buffer.from(secp256k1.sign(digest, key, { prehash:false, lowS:true, format:'der' })).toString('hex')}01`
  }));
  return encodePsbtV2({ ...base, inputs:[{ ...base.inputs[0], partialSignatures }] });
}

test('Bitcoin PSBTv2 extraction freezes exact segwit transaction and witness identities', () => {
  const transaction = extractBitcoinRecoveryTransaction({
    psbt:signedPsbt(), descriptor, rescueScriptPubKey
  });
  assert.equal(transaction.kind, 'bitcoin-signet-final-transaction');
  assert.equal(transaction.networkRef, 'bitcoin:signet');
  assert.match(transaction.rawHex, /^02000000000101/);
  assert.match(transaction.txid, /^[0-9a-f]{64}$/);
  assert.match(transaction.wtxid, /^[0-9a-f]{64}$/);
  assert.notEqual(transaction.txid, transaction.wtxid);
  assert.deepEqual(transaction.witnesses[0].selectedSigners, descriptor.contactKeys);
  assert.equal(transaction.witnesses[0].stackItems[0], '');
  assert.equal(transaction.witnesses[0].stackItems.at(-2), '');
  assert.equal(transaction.witnesses[0].stackItems.at(-1), descriptor.witnessScriptHex);
  assert.equal(transaction.txid, '0b01a21c7889debcbfb405d4bca27c1c3c3eb11979bbb516567ae0c99f517961');
  assert.equal(transaction.wtxid, '48dc875636a696ba86926bc62a5fd27ed28c94902f9784f9f0adf0a4b2eb836b');
  assert.equal(transaction.bytes, 347);
  assert.equal(transaction.strippedBytes, 82);
  assert.equal(transaction.weight, 593);
  assert.equal(transaction.virtualBytes, 149);
  assert.equal(transaction.broadcastAuthorized, false);
  assert.equal(transaction.signetExecutionProven, false);
  assert.equal(transaction.bitcoinCoreCrossCheckProven, false);
});

test('Bitcoin final-transaction evidence binds extraction, fee, rescue and authority boundary', () => {
  const psbt = signedPsbt();
  const evidence = createBitcoinFinalTransactionEvidence({ psbt, descriptor, rescueScriptPubKey });
  assert.equal(evidence.schema, 'omegavault.bitcoin.final-transaction-evidence.v1');
  assert.equal(evidence.feeSats, '1000');
  assert.equal(evidence.rescueAmountSats, '99000');
  assert.equal(evidence.inputWitnesses[0].selectedSigners.length, 2);
  assert.equal(evidence.broadcastAuthorized, false);
  assert.equal(evidence.bitcoinCoreCrossCheckProven, false);
  assert.deepEqual(
    verifyBitcoinFinalTransactionEvidence({ evidence, psbt, descriptor, rescueScriptPubKey }),
    { ok:true, errors:[] }
  );
});

test('Bitcoin extraction rejects incomplete and unexpected recovery signers', () => {
  assert.throws(
    () => extractBitcoinRecoveryTransaction({ psbt:signedPsbt({ signers:[contactPrivateKeyA] }), descriptor, rescueScriptPubKey }),
    /valid signature.*2 required/i
  );
  assert.throws(
    () => extractBitcoinRecoveryTransaction({ psbt:signedPsbt({ signers:[contactPrivateKeyA, outsiderPrivateKey] }), descriptor, rescueScriptPubKey }),
    /unexpected recovery signer/i
  );
});

test('Bitcoin extraction rejects descriptor, CSV and rescue-output substitution', () => {
  const psbt = signedPsbt();
  const wrongDescriptor = { ...descriptor, witnessScriptHex:'51' };
  assert.throws(
    () => extractBitcoinRecoveryTransaction({ psbt, descriptor:wrongDescriptor, rescueScriptPubKey }),
    /witnessScriptHex is not canonical/i
  );
  const lowSequence = signedPsbt({ overrides:{ inputs:[{ ...intent().inputs[0], sequence:143 }] } });
  assert.throws(
    () => extractBitcoinRecoveryTransaction({ psbt:lowSequence, descriptor, rescueScriptPubKey }),
    /CSV policy/i
  );
  assert.throws(
    () => extractBitcoinRecoveryTransaction({ psbt, descriptor, rescueScriptPubKey:`0014${'22'.repeat(20)}` }),
    /exactly one configured rescue output/i
  );
});

test('Bitcoin extraction rejects non-canonical contact order before witness construction', () => {
  const psbt = signedPsbt();
  assert.throws(
    () => extractBitcoinRecoveryTransaction({
      psbt,
      descriptor:{ ...descriptor, contactKeys:[...descriptor.contactKeys].reverse() },
      rescueScriptPubKey
    }),
    /contactKeys are not in canonical script order/i
  );
});

test('tampered Bitcoin final-transaction evidence fails closed', () => {
  const psbt = signedPsbt();
  const evidence = structuredClone(createBitcoinFinalTransactionEvidence({ psbt, descriptor, rescueScriptPubKey }));
  evidence.wtxid = '00'.repeat(32);
  assert.equal(verifyBitcoinFinalTransactionEvidence({ evidence, psbt, descriptor, rescueScriptPubKey }).ok, false);
});

test('every Bitcoin finalization entry point rejects descriptor policy substitution', () => {
  const psbt = signedPsbt();
  for (const changed of [
    { threshold:1 }, { csvBlocks:1 }, { ownerKey:publicKey(outsiderPrivateKey) },
    { contactKeys:[...descriptor.contactKeys].reverse() },
    { policyDigest:'00'.repeat(32) }, { checkedDescriptor:'forged' }
  ]) {
    const options = { psbt, descriptor:{ ...descriptor, ...changed }, rescueScriptPubKey, expectedFeeSats:'1000' };
    for (const finalize of [finalizePsbtV2RecoveryTransaction, createBitcoinFinalizerEvidence, extractBitcoinRecoveryTransaction]) {
      assert.throws(() => finalize(options), /canonical/, `${finalize.name}: ${JSON.stringify(changed)}`);
    }
  }
});

test('lowered descriptor threshold cannot turn one signature into completed recovery evidence', () => {
  const options = {
    psbt:signedPsbt({ signers:[contactPrivateKeyA] }),
    descriptor:{ ...descriptor, threshold:1 }, rescueScriptPubKey, expectedFeeSats:'1000'
  };
  assert.throws(() => createBitcoinFinalizerEvidence(options), /canonical/);
  assert.throws(() => finalizePsbtV2RecoveryTransaction(options), /canonical/);
});

test('both Bitcoin finalizers produce identical bytes for a canonical recovery descriptor', () => {
  const options = { psbt:signedPsbt(), descriptor, rescueScriptPubKey, expectedFeeSats:'1000' };
  const finalized = finalizePsbtV2RecoveryTransaction(options);
  const extracted = extractBitcoinRecoveryTransaction(options);
  assert.equal(finalized.rawTransactionHex, extracted.rawHex);
  assert.equal(finalized.txid, extracted.txid);
  assert.equal(finalized.wtxid, extracted.wtxid);
});

test('decoded PSBT recovery paths reject fields substituted independently of serialized bytes', () => {
  const decoded = decodePsbtV2(signedPsbt());
  const operations = [
    psbt => createBitcoinWitnessV0Sighash({ psbt, inputIndex:0 }),
    psbt => verifyPsbtV2RecoverySignature({ psbt, inputIndex:0, publicKey:contactKeyA }),
    psbt => verifyPsbtV2RecoveryThreshold({ psbt, inputIndex:0, requiredPublicKeys:descriptor.contactKeys, threshold:2 }),
    psbt => finalizePsbtV2RecoveryTransaction({ psbt, descriptor, rescueScriptPubKey, expectedFeeSats:'1000' })
  ];
  for (const mutate of [
    psbt => { psbt.inputs[0].partialSignatures[0].signature = psbt.inputs[0].partialSignatures[0].signature.slice(0,-2)+'02'; },
    psbt => { psbt.outputs[0].amountSats = '98000'; },
    psbt => { psbt.inputs[0].amountSats = '100001'; },
    psbt => { psbt.canonicalMaps = false; },
    psbt => { psbt.hex = '00'; },
    psbt => { delete psbt.base64; }
  ]) {
    const substituted = structuredClone(decoded);
    mutate(substituted);
    for (const operation of operations) assert.throws(() => operation(substituted), /decoded PSBT/i);
  }
});

test('authentic decoded PSBT objects and serialized clones retain identical recovery results', () => {
  const bytes = signedPsbt();
  const decoded = decodePsbtV2(bytes);
  const finalize = psbt => finalizePsbtV2RecoveryTransaction({ psbt, descriptor, rescueScriptPubKey, expectedFeeSats:'1000' });
  for (const psbt of [decoded, structuredClone(decoded), JSON.parse(JSON.stringify(decoded))]) {
    assert.deepEqual(finalize(psbt), finalize(bytes));
    assert.equal(verifyPsbtV2RecoverySignature({ psbt, inputIndex:0, publicKey:contactKeyA }).valid, true);
  }
});

