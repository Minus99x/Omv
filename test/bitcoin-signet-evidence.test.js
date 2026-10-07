import test from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { createBitcoinFinalizerEvidence } from '../src/chains/bitcoin/finalizer-evidence.js';
import { createBitcoinFinalTransactionEvidence } from '../src/chains/bitcoin/transaction-finalizer.js';
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

function finalizerArtifacts() {
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
  const finalizer = createBitcoinFinalizerEvidence({ psbt:signed, descriptor, rescueScriptPubKey });
  const finalTransaction = createBitcoinFinalTransactionEvidence({ psbt:signed, descriptor, rescueScriptPubKey });
  return { finalizer, finalTransaction };
}

function observations(evidence, overrides = {}) {
  const transactionId = '0b01a21c7889debcbfb405d4bca27c1c3c3eb11979bbb516567ae0c99f517961';
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
    chainTip:{
      networkRef:'bitcoin:signet',
      blockHash:'12'.repeat(32),
      blockHeight:'300005',
      observedAt:'2026-10-04T00:01:00Z',
      ...(overrides.chainTip ?? {})
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
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);
  const evidence = createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo });
  assert.equal(evidence.signetObservationComplete, true);
  assert.equal(evidence.observationSource, 'offline-fixture');
  assert.equal(evidence.publicSignetObservationProven, false);
  assert.equal(evidence.transaction.confirmations, '6');
  assert.equal(evidence.rescueUtxo.amountSats, '99000');
  assert.equal(evidence.immutableRescueOnChain, false);
  assert.equal(evidence.chainPromotionAuthority, false);
  assert.match(evidence.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyBitcoinSignetObservationEvidence({
    evidence, finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo
  }), { ok:true, errors:[] });
});

test('Bitcoin Signet observation evidence rejects insufficient confirmations', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer, { transaction:{ confirmations:'5' } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo }),
    /required confirmation depth/i
  );
});

test('Bitcoin Signet observation evidence rejects rescue outpoint substitution', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer, { rescueUtxo:{ txid:'aa'.repeat(32) } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo }),
    /another transaction/i
  );
});

test('Bitcoin Signet observation evidence rejects rescue amount or script drift', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const amountDrift = observations(finalizer, { rescueUtxo:{ amountSats:'98999' } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...amountDrift }),
    /amount does not match/i
  );
  const scriptDrift = observations(finalizer, { rescueUtxo:{ scriptPubKey:`0014${'22'.repeat(20)}` } });
  assert.throws(
    () => createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, ...scriptDrift }),
    /script does not match/i
  );
});

test('Bitcoin Signet evidence rejects final-transaction substitution and stale chain-tip observations', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const observation = observations(finalizer);
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer,
      finalTransactionEvidence:{ ...finalTransaction, wtxid:'aa'.repeat(32) },
      ...observation
    }),
    /digest is invalid/i
  );
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer,
      finalTransactionEvidence:{ ...finalTransaction, txid:'aa'.repeat(32) },
      ...observation
    }),
    /digest is invalid/i
  );
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer,
      finalTransactionEvidence:finalTransaction,
      ...observations(finalizer, { chainTip:{ observedAt:'2026-10-03T23:59:59Z' } })
    }),
    /stale relative/i
  );
  assert.throws(
    () => createBitcoinSignetObservationEvidence({
      finalizerEvidence:finalizer,
      finalTransactionEvidence:finalTransaction,
      ...observations(finalizer, { chainTip:{ blockHeight:'300006' } })
    }),
    /confirmation count does not match/i
  );
});

test('Bitcoin Signet observation runner is read-only and binds driver results', async () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);
  const calls = [];
  const driver = {
    async readTransaction(request) {
      calls.push(['readTransaction', request]);
      return transaction;
    },
    async readChainTip(request) {
      calls.push(['readChainTip', request]);
      return chainTip;
    },
    async readTxOut(request) {
      calls.push(['readTxOut', request]);
      return rescueUtxo;
    }
  };
  const result = await runBitcoinSignetObservationProof({
    driver,
    finalizerEvidence:finalizer,
    finalTransactionEvidence:finalTransaction
  });
  assert.equal(result.success, true);
  assert.equal(result.kind, 'bitcoin-signet-observation-proof');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call[0]), ['readTransaction','readChainTip','readTxOut']);
  assert.equal(result.evidence.rescueUtxo.txid, transaction.transactionId);
});

test('Bitcoin Signet provenance separates fixture, imported and live RPC observations', async () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);

  const imported = createBitcoinSignetObservationEvidence({
    finalizerEvidence:finalizer,
    finalTransactionEvidence:finalTransaction,
    transaction,
    chainTip,
    rescueUtxo,
    observationSource:'imported-json'
  });
  assert.equal(imported.observationSource, 'imported-json');
  assert.equal(imported.publicSignetObservationProven, false);
  assert.equal(imported.chainPromotionAuthority, false);

  const driver = {
    async readTransaction() { return transaction; },
    async readChainTip() { return chainTip; },
    async readTxOut() { return rescueUtxo; }
  };
  await assert.rejects(
    () => runBitcoinSignetObservationProof({
      driver,
      finalizerEvidence:finalizer,
      finalTransactionEvidence:finalTransaction,
      observationSource:'bitcoin-core-rpc'
    }),
    /requires a driver with bitcoin-core-rpc provenance/i
  );

  const live = await runBitcoinSignetObservationProof({
    driver:{ ...driver, provenance:'bitcoin-core-rpc' },
    finalizerEvidence:finalizer,
    finalTransactionEvidence:finalTransaction,
    observationSource:'bitcoin-core-rpc'
  });
  assert.equal(live.evidence.observationSource, 'bitcoin-core-rpc');
  assert.equal(live.evidence.publicSignetObservationProven, true);
  assert.equal(live.evidence.chainPromotionAuthority, false);
  assert.equal(live.evidence.immutableRescueOnChain, false);
});

test('Bitcoin Signet observation runner rejects driver transaction substitution', async () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);
  const driver = {
    async readTransaction() {
      return { ...transaction, transactionId:'aa'.repeat(32) };
    },
    async readChainTip() {
      return chainTip;
    },
    async readTxOut() {
      return rescueUtxo;
    }
  };
  await assert.rejects(
    () => runBitcoinSignetObservationProof({
      driver,
      finalizerEvidence:finalizer,
      finalTransactionEvidence:finalTransaction
    }),
    /different transaction/i
  );
});

test('tampered Bitcoin Signet observation evidence fails closed', () => {
  const { finalizer, finalTransaction } = finalizerArtifacts();
  const { transaction, chainTip, rescueUtxo } = observations(finalizer);
  const evidence = structuredClone(createBitcoinSignetObservationEvidence({ finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo }));
  evidence.transaction.confirmations = '7';
  assert.equal(verifyBitcoinSignetObservationEvidence({
    evidence, finalizerEvidence:finalizer, finalTransactionEvidence:finalTransaction, transaction, chainTip, rescueUtxo
  }).ok, false);
});
