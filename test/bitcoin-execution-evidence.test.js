import test from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import {
  createBitcoinRecoveryFinalizerEvidence,
  verifyBitcoinRecoveryFinalizerEvidence
} from '../src/chains/bitcoin/execution-evidence.js';

const privateKey = value => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
const publicKey = key => Buffer.from(secp256k1.getPublicKey(key, true)).toString('hex');
const ownerPrivateKey = privateKey(1);
const contactPrivateKeyA = privateKey(2);
const contactPrivateKeyB = privateKey(3);
const ownerKey = publicKey(ownerPrivateKey);
const contactKeyA = publicKey(contactPrivateKeyA);
const contactKeyB = publicKey(contactPrivateKeyB);

function fixture() {
  const descriptor = createBitcoinRecoveryDescriptor({
    ownerKey,
    contactKeys: [contactKeyB, contactKeyA],
    threshold: 2,
    csvBlocks: 144,
    network: 'signet'
  });
  const intent = {
    txVersion: 2,
    fallbackLocktime: 0,
    txModifiable: 0,
    inputs: [{
      txid: 'ab'.repeat(32),
      vout: 0,
      sequence: 144,
      amountSats: '100000',
      scriptPubKey: descriptor.scriptPubKeyHex,
      witnessScript: descriptor.witnessScriptHex
    }],
    outputs: [{ amountSats: '99000', scriptPubKey: `0014${'11'.repeat(20)}` }]
  };
  const unsigned = encodePsbtV2(intent);
  const { digest } = createBitcoinWitnessV0Sighash({ psbt: unsigned, inputIndex: 0 });
  const signatureA = secp256k1.sign(digest, contactPrivateKeyA, { prehash: false, lowS: true, format: 'der' });
  const signatureB = secp256k1.sign(digest, contactPrivateKeyB, { prehash: false, lowS: true, format: 'der' });
  const psbt = encodePsbtV2({
    ...intent,
    inputs: [{
      ...intent.inputs[0],
      partialSignatures: [
        { publicKey: contactKeyB, signature: `${Buffer.from(signatureB).toString('hex')}01` },
        { publicKey: contactKeyA, signature: `${Buffer.from(signatureA).toString('hex')}01` }
      ]
    }]
  });
  return {
    descriptor,
    psbt,
    rescueScriptPubKey: `0014${'11'.repeat(20)}`,
    expectedFeeSats: '1000'
  };
}

test('Bitcoin finalizer execution evidence deterministically binds the signed PSBT and extracted transaction', () => {
  const input = fixture();
  const first = createBitcoinRecoveryFinalizerEvidence(input);
  const second = createBitcoinRecoveryFinalizerEvidence(fixture());
  assert.equal(first.ok, true);
  assert.equal(first.evidence.status, 'verified-offline');
  assert.equal(first.evidence.schema, 'omegavault.bitcoin-finalizer-execution-evidence.v1');
  assert.equal(first.evidence.evidenceLevel, 'offline-finalizer-execution');
  assert.equal(first.evidence.execution.feeSats, '1000');
  assert.equal(first.evidence.execution.inputs[0].relativeValue, 144);
  assert.deepEqual(first.evidence.execution.inputs[0].selectedSigners, input.descriptor.contactKeys);
  assert.match(first.evidence.execution.txid, /^[0-9a-f]{64}$/);
  assert.match(first.evidence.execution.wtxid, /^[0-9a-f]{64}$/);
  assert.match(first.evidence.psbtSha256, /^[0-9a-f]{64}$/);
  assert.match(first.evidence.execution.rawTransactionSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.evidence.sha256, second.evidence.sha256);
});

test('Bitcoin finalizer evidence verifies by reproducing execution and rejects tampering', () => {
  const input = fixture();
  const created = createBitcoinRecoveryFinalizerEvidence(input);
  const verified = verifyBitcoinRecoveryFinalizerEvidence({ evidence: created.evidence, ...input });
  assert.equal(verified.valid, true, verified.errors.join('; '));
  const tampered = structuredClone(created.evidence);
  tampered.execution.feeSats = '999';
  const rejected = verifyBitcoinRecoveryFinalizerEvidence({ evidence: tampered, ...input });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(error => /self-digest mismatch/i.test(error)));
});

test('Bitcoin finalizer execution evidence preserves reduced semantics and makes no live Signet claim', () => {
  const result = createBitcoinRecoveryFinalizerEvidence(fixture());
  assert.equal(result.evidence.semantics.omegaVaultOutputBound, true);
  assert.equal(result.evidence.semantics.immutableRescueOnChain, false);
  assert.equal(result.evidence.semantics.publicNetworkProof, false);
  assert.equal(result.evidence.semantics.broadcastObserved, false);
  assert.match(result.evidence.authorityBoundary, /does not prove Signet broadcast/i);
});

test('Bitcoin finalizer evidence fails closed on wrong rescue, fee, or non-Signet descriptor scope', () => {
  const input = fixture();
  assert.throws(() => createBitcoinRecoveryFinalizerEvidence({
    ...input,
    rescueScriptPubKey: `0014${'22'.repeat(20)}`
  }), /rescue output/);
  assert.throws(() => createBitcoinRecoveryFinalizerEvidence({
    ...input,
    expectedFeeSats: '999'
  }), /fee mismatch/);

  const mainnetDescriptor = createBitcoinRecoveryDescriptor({
    ownerKey,
    contactKeys: [contactKeyA, contactKeyB],
    threshold: 2,
    csvBlocks: 144,
    network: 'mainnet'
  });
  assert.throws(() => createBitcoinRecoveryFinalizerEvidence({
    ...input,
    descriptor: mainnetDescriptor
  }), /scoped to Signet/);
});
