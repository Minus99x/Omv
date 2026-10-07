import test from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { extractBitcoinRecoveryTransaction } from '../src/chains/bitcoin/transaction-finalizer.js';
import { createBitcoinCoreCrossCheckEvidence, runBitcoinCoreCrossCheck, verifyBitcoinCoreCrossCheckEvidence } from '../src/chains/bitcoin/core-cross-check.js';

const key = value => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
const pub = value => Buffer.from(secp256k1.getPublicKey(value, true)).toString('hex');
const contacts = [key(2), key(3)];
const rescueScriptPubKey = `0014${'11'.repeat(20)}`;
const descriptor = createBitcoinRecoveryDescriptor({ ownerKey:pub(key(1)), contactKeys:contacts.map(pub), threshold:2, csvBlocks:144, network:'signet' });

function transaction() {
  const intent = {
    txVersion:2, fallbackLocktime:0, txModifiable:0,
    inputs:[{ txid:'ab'.repeat(32), vout:0, sequence:144, amountSats:'100000', scriptPubKey:descriptor.scriptPubKeyHex, witnessScript:descriptor.witnessScriptHex }],
    outputs:[{ amountSats:'99000', scriptPubKey:rescueScriptPubKey }]
  };
  const unsigned = encodePsbtV2(intent);
  const { digest } = createBitcoinWitnessV0Sighash({ psbt:unsigned, inputIndex:0 });
  const partialSignatures = contacts.map(privateKey => ({ publicKey:pub(privateKey), signature:`${Buffer.from(secp256k1.sign(digest, privateKey, { prehash:false, lowS:true, format:'der' })).toString('hex')}01` }));
  return extractBitcoinRecoveryTransaction({ psbt:encodePsbtV2({ ...intent, inputs:[{ ...intent.inputs[0], partialSignatures }] }), descriptor, rescueScriptPubKey });
}

function observations(tx, overrides = {}) {
  return {
    node:{ chain:'signet', version:310100, subversion:'/Satoshi:31.1.0/', protocolVersion:70016 },
    decodedTransaction:{
      txid:tx.txid, hash:tx.wtxid, size:tx.bytes, vsize:tx.virtualBytes, weight:tx.weight,
      version:2, locktime:0,
      vin:[{ txid:'ab'.repeat(32), vout:0, scriptSig:{ hex:'' }, txinwitness:tx.witnesses[0].stackItems, sequence:144 }],
      vout:[{ value:'0.00099000', n:0, scriptPubKey:{ hex:rescueScriptPubKey } }]
    },
    mempoolResult:{ txid:tx.txid, wtxid:tx.wtxid, allowed:true, vsize:tx.virtualBytes },
    ...overrides
  };
}

test('Bitcoin Core fixture cross-check binds node, decode and mempool identities without promotion', () => {
  const tx = transaction();
  const input = observations(tx);
  const evidence = createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input });
  assert.equal(evidence.schema, 'omegavault.bitcoin.core-cross-check-evidence.v1');
  assert.equal(evidence.decodedTransactionMatches, true);
  assert.equal(evidence.mempool.allowed, true);
  assert.equal(evidence.bitcoinCoreCrossCheckProven, false);
  assert.equal(evidence.broadcastPerformed, false);
  assert.equal(evidence.signetExecutionProven, false);
  assert.deepEqual(verifyBitcoinCoreCrossCheckEvidence({ evidence, transaction:tx, ...input }), { ok:true, errors:[] });
});

test('read-only Bitcoin Core driver binds actual RPC-source observations', async () => {
  const tx = transaction();
  const input = observations(tx);
  const calls = [];
  const evidence = await runBitcoinCoreCrossCheck({
    transaction:tx,
    driver:{
      getNetworkInfo:async () => (calls.push('network'), { version:310100, subversion:'/Satoshi:31.1.0/', protocolversion:70016 }),
      getBlockchainInfo:async () => (calls.push('chain'), { chain:'signet' }),
      decodeRawTransaction:async ({ rawHex }) => (calls.push(['decode', rawHex]), input.decodedTransaction),
      testMempoolAccept:async ({ rawTransactions }) => (calls.push(['mempool', rawTransactions]), [input.mempoolResult])
    }
  });
  assert.equal(evidence.observationSource, 'bitcoin-core-rpc');
  assert.equal(evidence.bitcoinCoreCrossCheckProven, true);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'decode' && call[1] === tx.rawHex), true);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'mempool' && call[1][0] === tx.rawHex), true);
});

test('Bitcoin Core cross-check rejects wrong network or unpinned node version', () => {
  const tx = transaction();
  const input = observations(tx);
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, node:{ ...input.node, chain:'main' } }), /Signet chain identity/);
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, node:{ ...input.node, version:310000 } }), /pinned value/);
});

test('Bitcoin Core cross-check rejects txid, witness and output substitution', () => {
  const tx = transaction();
  const input = observations(tx);
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, decodedTransaction:{ ...input.decodedTransaction, txid:'00'.repeat(32) } }), /decoded txid/);
  const wrongWitness = structuredClone(input.decodedTransaction);
  wrongWitness.vin[0].txinwitness[1] = '00';
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, decodedTransaction:wrongWitness }), /decoded witness/);
  const wrongOutput = structuredClone(input.decodedTransaction);
  wrongOutput.vout[0].value = '0.00098000';
  assert.throws(() => createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input, decodedTransaction:wrongOutput }), /output 0 amount/);
});

test('Bitcoin Core rejected mempool observation is bound without claiming proof', () => {
  const tx = transaction();
  const input = observations(tx);
  const evidence = createBitcoinCoreCrossCheckEvidence({
    transaction:tx, ...input,
    observationSource:'bitcoin-core-rpc',
    mempoolResult:{ ...input.mempoolResult, allowed:false, 'reject-reason':'bad-txns-inputs-missingorspent' }
  });
  assert.equal(evidence.mempool.allowed, false);
  assert.equal(evidence.mempool.rejectReason, 'bad-txns-inputs-missingorspent');
  assert.equal(evidence.bitcoinCoreCrossCheckProven, false);
});

test('tampered Bitcoin Core cross-check evidence fails closed', () => {
  const tx = transaction();
  const input = observations(tx);
  const evidence = structuredClone(createBitcoinCoreCrossCheckEvidence({ transaction:tx, ...input }));
  evidence.node.version = 310000;
  assert.equal(verifyBitcoinCoreCrossCheckEvidence({ evidence, transaction:tx, ...input }).ok, false);
});
