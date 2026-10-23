import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor, descriptorChecksum } from '../src/chains/bitcoin/descriptor.js';
import {
  createBitcoinWitnessV0Sighash, decodePsbtV2, encodePsbtV2,
  verifyPsbtV2RecoverySignature, verifyPsbtV2RecoveryThreshold, finalizePsbtV2RecoveryTransaction
} from '../src/chains/bitcoin/psbt-v2.js';

const privateKey = value => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
const publicKey = key => Buffer.from(secp256k1.getPublicKey(key, true)).toString('hex');
const ownerPrivateKey = privateKey(1);
const contactPrivateKeyA = privateKey(2);
const contactPrivateKeyB = privateKey(3);
const ownerKey = publicKey(ownerPrivateKey);
const contactKeyA = publicKey(contactPrivateKeyA);
const contactKeyB = publicKey(contactPrivateKeyB);

const descriptor = createBitcoinRecoveryDescriptor({
  ownerKey, contactKeys: [contactKeyB, contactKeyA], threshold: 2, csvBlocks: 144, network: 'signet'
});

const unsignedIntent = () => ({
  txVersion: 2,
  fallbackLocktime: 0,
  txModifiable: 0,
  inputs: [{
    txid: 'ab'.repeat(32), vout: 0, sequence: 144, amountSats: '100000',
    scriptPubKey: descriptor.scriptPubKeyHex, witnessScript: descriptor.witnessScriptHex
  }],
  outputs: [{ amountSats: '99000', scriptPubKey: `0014${'11'.repeat(20)}` }]
});

test('Bitcoin descriptor compiler matches the Bitcoin Core 31.1 Signet fixture', () => {
  assert.equal(ownerKey, '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  assert.equal(contactKeyA, '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
  assert.equal(contactKeyB, '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
  assert.equal(descriptor.checksum, 'r4lfukrv');
  assert.equal(descriptorChecksum(descriptor.descriptor), descriptor.checksum);
  assert.equal(descriptor.address, 'tb1qfcj4r3egr084d9ul6e0yw50gc7ax0r4hetkp6zy2q32p6csvf7aqzy28m9');
  assert.equal(descriptor.scriptPubKeyHex, '00204e2551c7281bcf56979fd65e4751e8c7ba678eb7caec1d088a04541d620c4fba');
  assert.equal(descriptor.witnessScriptHex, '210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac7364029000b269522102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee52102f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f952ae68');
  assert.equal(descriptor.semantics.immutableRescueOutput, false);
});

test('Bitcoin descriptor compiler rejects invalid, duplicate, and owner contact keys', () => {
  assert.throws(() => createBitcoinRecoveryDescriptor({ ownerKey: `02${'00'.repeat(32)}`, contactKeys: [contactKeyA], threshold: 1, csvBlocks: 1 }), /valid secp256k1 point/);
  assert.throws(() => createBitcoinRecoveryDescriptor({ ownerKey, contactKeys: [contactKeyA, contactKeyA], threshold: 1, csvBlocks: 1 }), /unique/);
  assert.throws(() => createBitcoinRecoveryDescriptor({ ownerKey, contactKeys: [ownerKey], threshold: 1, csvBlocks: 1 }), /cannot also be/);
});

test('Bitcoin PSBTv2 encoder emits a canonical frozen intent and round-trips required BIP 370 fields', () => {
  const encoded = encodePsbtV2(unsignedIntent());
  const decoded = decodePsbtV2(encoded);
  assert.equal(decoded.psbtVersion, 2);
  assert.equal(decoded.txVersion, 2);
  assert.equal(decoded.txModifiable, 0);
  assert.equal(decoded.canonicalMaps, true);
  assert.equal(decoded.inputs[0].txid, 'ab'.repeat(32));
  assert.equal(decoded.inputs[0].sequence, 144);
  assert.equal(decoded.inputs[0].amountSats, '100000');
  assert.equal(decoded.outputs[0].amountSats, '99000');
  assert.equal(createHash('sha256').update(encoded).digest('hex'), '2a8811f7ab4c6d3be786ae39e711ee733591bcaff2f357306dac165ead0f3779');
});

test('Bitcoin BIP143 signatures are verified against the exact frozen PSBTv2 transaction', () => {
  const unsigned = encodePsbtV2(unsignedIntent());
  const { digest } = createBitcoinWitnessV0Sighash({ psbt: unsigned, inputIndex: 0 });
  const signatureA = secp256k1.sign(digest, contactPrivateKeyA, { prehash: false, lowS: true, format: 'der' });
  const signatureB = secp256k1.sign(digest, contactPrivateKeyB, { prehash: false, lowS: true, format: 'der' });
  const signed = encodePsbtV2({
    ...unsignedIntent(),
    inputs: [{
      ...unsignedIntent().inputs[0],
      partialSignatures: [
        { publicKey: contactKeyA, signature: `${Buffer.from(signatureA).toString('hex')}01` },
        { publicKey: contactKeyB, signature: `${Buffer.from(signatureB).toString('hex')}01` }
      ]
    }]
  });
  const single = verifyPsbtV2RecoverySignature({ psbt: signed, inputIndex: 0, publicKey: contactKeyA, allowedPublicKeys: [contactKeyA, contactKeyB] });
  const threshold = verifyPsbtV2RecoveryThreshold({ psbt: signed, inputIndex: 0, requiredPublicKeys: [contactKeyA, contactKeyB], threshold: 2 });
  assert.equal(single.valid, true);
  assert.equal(threshold.validCount, 2);
  assert.equal(threshold.thresholdReached, true);

  const changedOutput = encodePsbtV2({
    ...unsignedIntent(),
    inputs: [{ ...unsignedIntent().inputs[0], partialSignatures: [{ publicKey: contactKeyA, signature: `${Buffer.from(signatureA).toString('hex')}01` }] }],
    outputs: [{ amountSats: '98000', scriptPubKey: `0014${'11'.repeat(20)}` }]
  });
  const changedDigest = createBitcoinWitnessV0Sighash({ psbt: changedOutput, inputIndex: 0 }).digest.toString('hex');
  assert.notEqual(changedDigest, digest.toString('hex'));
  assert.equal(verifyPsbtV2RecoverySignature({ psbt: changedOutput, inputIndex: 0, publicKey: contactKeyA }).valid, false);
});

test('Bitcoin PSBTv2 rejects mutable outputs and mismatched P2WSH scripts', () => {
  assert.throws(() => encodePsbtV2({ ...unsignedIntent(), txModifiable: 2 }), /freezes/);
  assert.throws(() => encodePsbtV2({
    ...unsignedIntent(), inputs: [{ ...unsignedIntent().inputs[0], witnessScript: '51' }]
  }), /does not match/);
});


test('Bitcoin recovery finalizer builds a deterministic witness transaction bound to the rescue output', () => {
  const unsigned = encodePsbtV2(unsignedIntent());
  const { digest } = createBitcoinWitnessV0Sighash({ psbt: unsigned, inputIndex: 0 });
  const signatureA = secp256k1.sign(digest, contactPrivateKeyA, { prehash: false, lowS: true, format: 'der' });
  const signatureB = secp256k1.sign(digest, contactPrivateKeyB, { prehash: false, lowS: true, format: 'der' });
  const signed = encodePsbtV2({
    ...unsignedIntent(),
    inputs: [{
      ...unsignedIntent().inputs[0],
      partialSignatures: [
        { publicKey: contactKeyB, signature: `${Buffer.from(signatureB).toString('hex')}01` },
        { publicKey: contactKeyA, signature: `${Buffer.from(signatureA).toString('hex')}01` }
      ]
    }]
  });
  const final = finalizePsbtV2RecoveryTransaction({
    psbt: signed,
    descriptor,
    rescueScriptPubKey: `0014${'11'.repeat(20)}`,
    expectedFeeSats: '1000'
  });
  assert.equal(final.feeSats, '1000');
  assert.equal(final.inputs[0].selectedSigners.join(','), descriptor.contactKeys.join(','));
  assert.equal(final.inputs[0].witnessItems[0], '');
  assert.equal(final.inputs[0].witnessItems.at(-2), '');
  assert.equal(final.inputs[0].witnessItems.at(-1), descriptor.witnessScriptHex);
  assert.equal(final.semantics.omegaVaultOutputBound, true);
  assert.equal(final.semantics.immutableRescueOnChain, false);
  assert.match(final.txid, /^[0-9a-f]{64}$/);
  assert.match(final.wtxid, /^[0-9a-f]{64}$/);
  assert.notEqual(final.txid, final.wtxid);
  assert.equal(final.rawTransactionHex.slice(8, 12), '0001');
  assert.ok(final.vsize > 0);
});

test('Bitcoin recovery finalizer fails closed on wrong rescue, fee, sequence, signer, and threshold', () => {
  const unsigned = encodePsbtV2(unsignedIntent());
  const { digest } = createBitcoinWitnessV0Sighash({ psbt: unsigned, inputIndex: 0 });
  const signatureA = secp256k1.sign(digest, contactPrivateKeyA, { prehash: false, lowS: true, format: 'der' });
  const oneSignature = encodePsbtV2({
    ...unsignedIntent(),
    inputs: [{ ...unsignedIntent().inputs[0], partialSignatures: [{ publicKey: contactKeyA, signature: `${Buffer.from(signatureA).toString('hex')}01` }] }]
  });
  assert.throws(() => finalizePsbtV2RecoveryTransaction({ psbt: oneSignature, descriptor, rescueScriptPubKey: `0014${'11'.repeat(20)}`, expectedFeeSats: '1000' }), /threshold/);
  assert.throws(() => finalizePsbtV2RecoveryTransaction({ psbt: oneSignature, descriptor, rescueScriptPubKey: `0014${'22'.repeat(20)}`, expectedFeeSats: '1000' }), /rescue output/);
  assert.throws(() => finalizePsbtV2RecoveryTransaction({ psbt: oneSignature, descriptor, rescueScriptPubKey: `0014${'11'.repeat(20)}`, expectedFeeSats: '999' }), /fee mismatch/);

  const shortSequence = encodePsbtV2({ ...unsignedIntent(), inputs: [{ ...unsignedIntent().inputs[0], sequence: 143 }] });
  assert.throws(() => finalizePsbtV2RecoveryTransaction({ psbt: shortSequence, descriptor, rescueScriptPubKey: `0014${'11'.repeat(20)}`, expectedFeeSats: '1000' }), /CSV delay/);

  const outsiderPrivateKey = privateKey(4);
  const outsiderKey = publicKey(outsiderPrivateKey);
  const outsiderSig = secp256k1.sign(digest, outsiderPrivateKey, { prehash: false, lowS: true, format: 'der' });
  const outsider = encodePsbtV2({
    ...unsignedIntent(),
    inputs: [{ ...unsignedIntent().inputs[0], partialSignatures: [{ publicKey: outsiderKey, signature: `${Buffer.from(outsiderSig).toString('hex')}01` }] }]
  });
  assert.throws(() => finalizePsbtV2RecoveryTransaction({ psbt: outsider, descriptor, rescueScriptPubKey: `0014${'11'.repeat(20)}`, expectedFeeSats: '1000' }), /unauthorized partial signer/);
});

function signedMoneyFixture() {
  const intent=unsignedIntent();
  const {digest}=createBitcoinWitnessV0Sighash({psbt:encodePsbtV2(intent),inputIndex:0});
  intent.inputs[0].partialSignatures=[contactPrivateKeyA,contactPrivateKeyB].map(key=>({
    publicKey:publicKey(key),
    signature:Buffer.from(secp256k1.sign(digest,key,{prehash:false,lowS:true,format:'der'})).toString('hex')+'01'
  }));
  return intent;
}

for (const field of ['input','output','fee']) {
  test(`Bitcoin PSBT monetary ${field} rejects coercible containers`,()=>{
    const intent=signedMoneyFixture();
    const amount=field==='input'?'100000':field==='output'?'99000':'1000';
    for (const invalid of [[amount],new String(amount),Object(BigInt(amount))]) {
      if (field==='fee') {
        assert.throws(()=>finalizePsbtV2RecoveryTransaction({
          psbt:encodePsbtV2(intent),descriptor,rescueScriptPubKey:intent.outputs[0].scriptPubKey,
          expectedFeeSats:invalid
        }),/must be a non-negative integer/);
      } else {
        const changed=structuredClone(intent);
        changed[field==='input'?'inputs':'outputs'][0].amountSats=invalid;
        assert.throws(()=>encodePsbtV2(changed),/must be a non-negative integer/);
      }
    }
  });

  test(`Bitcoin PSBT monetary ${field} rejects objects without invoking conversion hooks`,()=>{
    const intent=signedMoneyFixture();
    let conversions=0;
    const invalid={
      [Symbol.toPrimitive](){conversions++;return field==='input'?'100000':field==='output'?'99000':'1000';}
    };
    if (field==='fee') {
      assert.throws(()=>finalizePsbtV2RecoveryTransaction({
        psbt:encodePsbtV2(intent),descriptor,rescueScriptPubKey:intent.outputs[0].scriptPubKey,
        expectedFeeSats:invalid
      }),/must be a non-negative integer/);
    } else {
      intent[field==='input'?'inputs':'outputs'][0].amountSats=invalid;
      assert.throws(()=>encodePsbtV2(intent),/must be a non-negative integer/);
    }
    assert.equal(conversions,0);
  });
}

test('Bitcoin PSBT money preserves equivalent string number and bigint finalization',()=>{
  const intent=signedMoneyFixture();
  const expected=finalizePsbtV2RecoveryTransaction({
    psbt:encodePsbtV2(intent),descriptor,rescueScriptPubKey:intent.outputs[0].scriptPubKey,expectedFeeSats:'1000'
  });
  for (const convert of [String,Number,BigInt]) {
    const equivalent=structuredClone(intent);
    equivalent.inputs[0].amountSats=convert('100000');
    equivalent.outputs[0].amountSats=convert('99000');
    const actual=finalizePsbtV2RecoveryTransaction({
      psbt:encodePsbtV2(equivalent),descriptor,rescueScriptPubKey:intent.outputs[0].scriptPubKey,
      expectedFeeSats:convert('1000')
    });
    assert.equal(actual.rawTransactionHex,expected.rawTransactionHex);
    assert.equal(actual.feeSats,'1000');
  }
});

test('Bitcoin PSBT monetary validation retains zero and MAX_MONEY boundaries',()=>{
  const maximum=2100000000000000n;
  for (const convert of [String,Number,BigInt]) {
    const intent=unsignedIntent();
    intent.inputs[0].amountSats=convert(maximum);
    intent.outputs[0].amountSats=convert(0);
    const decoded=decodePsbtV2(encodePsbtV2(intent));
    assert.equal(decoded.inputs[0].amountSats,maximum.toString());
    assert.equal(decoded.outputs[0].amountSats,'0');
    intent.inputs[0].amountSats=convert(maximum+1n);
    assert.throws(()=>encodePsbtV2(intent),/MAX_MONEY/);
  }
  for (const invalid of [true,false,null,undefined,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1e3','-1']) {
    const intent=unsignedIntent();
    intent.inputs[0].amountSats=invalid;
    assert.throws(()=>encodePsbtV2(intent),/non-negative integer|MAX_MONEY/);
  }
});


test('PSBT base64 rejects padded aliases while preserving unpadded bytes', () => {
 const bytes=encodePsbtV2(unsignedIntent()); const encoded=bytes.toString('base64');
 assert.equal(decodePsbtV2(encoded.replace(/=+$/, '')).hex,bytes.toString('hex'));
 for(const value of [encoded+'=',encoded+'====',encoded.slice(0,10)+'='+encoded.slice(10)])
   assert.throws(()=>decodePsbtV2(value),/canonical base64/);
});



test('signature verification rejects malformed allowlists before processing signatures', () => {
 const unsigned=encodePsbtV2(unsignedIntent());
 const {digest}=createBitcoinWitnessV0Sighash({psbt:unsigned,inputIndex:0});
 const sig=Buffer.from(secp256k1.sign(digest,contactPrivateKeyA,{prehash:false,lowS:true,format:'der'})).toString('hex')+'01';
 const intent=unsignedIntent();intent.inputs[0].partialSignatures=[{publicKey:contactKeyA,signature:sig}];
 const psbt=encodePsbtV2(intent);
 for(const allowedPublicKeys of ['not-an-array',{},false,[{toString:()=>contactKeyA}]])
  assert.throws(()=>verifyPsbtV2RecoverySignature({psbt,inputIndex:0,publicKey:contactKeyA,allowedPublicKeys}),/allowedPublicKeys/);
 assert.equal(verifyPsbtV2RecoverySignature({psbt,inputIndex:0,publicKey:contactKeyA,allowedPublicKeys:[contactKeyA.toUpperCase()]}).valid,true);
});



test('PSBT wire parser rejects compressed keys that are not secp256k1 points', () => {
 const intent=unsignedIntent();intent.inputs[0].partialSignatures=[{publicKey:contactKeyA,signature:'300602010102010101'}];
 const bytes=encodePsbtV2(intent);const key=Buffer.from(contactKeyA,'hex');const at=bytes.indexOf(key);
 assert.ok(at>0);Buffer.from('02'+'00'.repeat(32),'hex').copy(bytes,at);
 assert.throws(()=>decodePsbtV2(bytes),/secp256k1 point/);
});

