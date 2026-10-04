import test from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { createBitcoinFinalizerEvidence } from '../src/chains/bitcoin/finalizer-evidence.js';
import {
  createBitcoinSignetObservationEvidence,
  runBitcoinSignetObservationProof,
  verifyBitcoinSignetObservationEvidence
} from '../src/chains/bitcoin/signet-evidence.js';

const priv = n => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const pub = key => Buffer.from(secp256k1.getPublicKey(key, true)).toString('hex');
const owner = priv(1), a = priv(2), b = priv(3);
const rescueScriptPubKey = `0014${'11'.repeat(20)}`;
const descriptor = createBitcoinRecoveryDescriptor({
  ownerKey:pub(owner), contactKeys:[pub(a), pub(b)], threshold:2, csvBlocks:144, network:'signet'
});

function finalizerEvidence() {
  const base = {
    txVersion:2,
    fallbackLocktime:0,
    txModifiable:0,
    inputs:[{
      txid:'ab'.repeat(32), vout:0, sequence:144, amountSats:'100000',
      scriptPubKey:descriptor.scriptPubKeyHex, witnessScript:descriptor.witnessScriptHex
    }],
    outputs:[{ amountSats:'99000', scriptPubKey:rescueScriptPubKey }]
  };
  const unsigned = encodePsbtV2(base);
  const { digest } = createBitcoinWitnessV0Sighash({ psbt:unsigned, inputIndex:0 });
  const partialSignatures = [a,b].map(key => ({
    publicKey:pub(key),
    signature:`${Buffer.from(secp256k1.sign(digest, key, { prehash:false, lowS:true, format:'der' })).toString('hex')}01`
  }));
  const signed = encodePsbtV2({
    ...base,
    inputs:[{ ...base.inputs[0], partialSignatures }]
  });
  return createBitcoinFinalizerEvidence({ psbt:signed, descriptor, rescueScriptPubKey });
}

function observations(evidence, overrides = {}) {
  const transactionId = 'cd'.repeat(32);
  return {
    transaction:{
      transactionId,
      networkRef:'bitcoin:signet',
      confirmations:'6',
      blockHash:'ef'.repeat(32),
      blockHeight:'300000',
      observedAt:'2026-10-04T00:00:00Z',
      ...(overrides.transaction ?? {})
    },
    rescueUtxo:{
      txid:transactionId,
      vout:0,
      amountSats:evidence.rescueAmountSats,
      scriptPubKey:evidence.rescueScriptPubKey,
      unspent:true,
      ...(overrides.rescueUtxo ?? {})
    }
  };
}

test('Bitcoin Signet observation evidence binds confirmation depth and exact rescue UTXO', () => {
  const finalizer = finalizerEvidence();
  const { transaction, rescueUtxo } = observations(finalizer);
  const evidence = createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, transaction, rescueUtxo });
  assert.equal(evidence.signetObservationComplete, true);
  assert.equal(evidence.transaction.confirmations, '6');
  assert.equal(evidence.rescueUtxo.amountSats, '99000');
  assert.equal(evidence.immutableRescueOnChain, false);
  assert.equal(evidence.chainPromotionAuthority, false);
  assert.match(evidence.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyBitcoinSignetObservationEvidence({
    evidence, finalizerEvidence:finalizer, transaction, rescueUtxo
  }), { ok:true, errors:[] });
});

test('Bitcoin Signet observation evidence rejects insufficient confirmations', () => {
  const finalizer = finalizerEvidence();
  const { transaction, rescueUtxo } = observations(finalizer, { transaction:{ confirmations:'5' } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, transaction, rescueUtxo }),
    /required confirmation depth/i
  );
});

test('Bitcoin Signet observation evidence rejects rescue outpoint substitution', () => {
  const finalizer = finalizerEvidence();
  const { transaction, rescueUtxo } = observations(finalizer, { rescueUtxo:{ txid:'aa'.repeat(32) } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, transaction, rescueUtxo }),
    /another transaction/i
  );
});

test('Bitcoin Signet observation evidence rejects rescue amount or script drift', () => {
  const finalizer = finalizerEvidence();
  const amountDrift = observations(finalizer, { rescueUtxo:{ amountSats:'98999' } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, ...amountDrift }),
    /amount does not match/i
  );
  const scriptDrift = observations(finalizer, { rescueUtxo:{ scriptPubKey:`0014${'22'.repeat(20)}` } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, ...scriptDrift }),
    /script does not match/i
  );
});

test('Bitcoin Signet observation runner is read-only and binds driver results', async () => {
  const finalizer = finalizerEvidence();
  const { transaction, rescueUtxo } = observations(finalizer);
  const calls = [];
  const driver = {
    async readTransaction(request) {
      calls.push(['readTransaction', request]);
      return transaction;
    },
    async readTxOut(request) {
      calls.push(['readTxOut', request]);
      return rescueUtxo;
    }
  };
  const result = await runBitcoinSignetObservationProof({
    driver,
    finalizerEvidence:finalizer,
    transactionId:transaction.transactionId
  });
  assert.equal(result.success, true);
  assert.equal(result.kind, 'bitcoin-signet-observation-proof');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call[0]), ['readTransaction','readTxOut']);
  assert.equal(result.evidence.rescueUtxo.txid, transaction.transactionId);
});

test('Bitcoin Signet observation runner rejects driver transaction substitution', async () => {
  const finalizer = finalizerEvidence();
  const { transaction, rescueUtxo } = observations(finalizer);
  const driver = {
    async readTransaction() {
      return { ...transaction, transactionId:'aa'.repeat(32) };
    },
    async readTxOut() {
      return rescueUtxo;
    }
  };
  await assert.rejects(
    () => runBitcoinSignetObservationProof({
      driver,
      finalizerEvidence:finalizer,
      transactionId:transaction.transactionId
    }),
    /different transaction/i
  );
});

test('tampered Bitcoin Signet observation evidence fails closed', () => {
  const finalizer = finalizerEvidence();
  const { transaction, rescueUtxo } = observations(finalizer);
  const evidence = structuredClone(createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, transaction, rescueUtxo }));
  evidence.transaction.confirmations = '7';
  assert.equal(verifyBitcoinSignetObservationEvidence({
    evidence, finalizerEvidence:finalizer, transaction, rescueUtxo
  }).ok, false);
});
