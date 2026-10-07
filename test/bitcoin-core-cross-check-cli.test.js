import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createBitcoinRecoveryDescriptor } from '../src/chains/bitcoin/descriptor.js';
import { createBitcoinWitnessV0Sighash, encodePsbtV2 } from '../src/chains/bitcoin/psbt-v2.js';
import { extractBitcoinRecoveryTransaction } from '../src/chains/bitcoin/transaction-finalizer.js';

const key = value => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
const pub = value => Buffer.from(secp256k1.getPublicKey(value, true)).toString('hex');

function fixture() {
  const contacts = [key(2), key(3)];
  const rescueScriptPubKey = `0014${'11'.repeat(20)}`;
  const descriptor = createBitcoinRecoveryDescriptor({ ownerKey:pub(key(1)), contactKeys:contacts.map(pub), threshold:2, csvBlocks:144, network:'signet' });
  const intent = {
    txVersion:2, fallbackLocktime:0, txModifiable:0,
    inputs:[{ txid:'ab'.repeat(32), vout:0, sequence:144, amountSats:'100000', scriptPubKey:descriptor.scriptPubKeyHex, witnessScript:descriptor.witnessScriptHex }],
    outputs:[{ amountSats:'99000', scriptPubKey:rescueScriptPubKey }]
  };
  const { digest } = createBitcoinWitnessV0Sighash({ psbt:encodePsbtV2(intent), inputIndex:0 });
  const partialSignatures = contacts.map(privateKey => ({ publicKey:pub(privateKey), signature:`${Buffer.from(secp256k1.sign(digest, privateKey, { prehash:false, lowS:true, format:'der' })).toString('hex')}01` }));
  const transaction = extractBitcoinRecoveryTransaction({ psbt:encodePsbtV2({ ...intent, inputs:[{ ...intent.inputs[0], partialSignatures }] }), descriptor, rescueScriptPubKey });
  const observations = {
    schema:'omegavault.bitcoin.core-cross-check-observations.v1',
    node:{ chain:'signet', version:310100, subversion:'/Satoshi:31.1.0/', protocolVersion:70016 },
    decodedTransaction:{
      txid:transaction.txid, hash:transaction.wtxid, size:transaction.bytes, vsize:transaction.virtualBytes, weight:transaction.weight,
      version:2, locktime:0,
      vin:[{ txid:'ab'.repeat(32), vout:0, scriptSig:{ hex:'' }, txinwitness:transaction.witnesses[0].stackItems, sequence:144 }],
      vout:[{ value:'0.00099000', n:0, scriptPubKey:{ hex:rescueScriptPubKey } }]
    },
    mempoolResult:{ txid:transaction.txid, wtxid:transaction.wtxid, allowed:true, vsize:transaction.virtualBytes }
  };
  return { transaction, observations };
}

function files() {
  const dir = mkdtempSync(join(tmpdir(), 'omegavault-bitcoin-core-'));
  const transaction = join(dir, 'transaction.json');
  const observations = join(dir, 'observations.json');
  const output = join(dir, 'evidence.json');
  const value = fixture();
  writeFileSync(transaction, JSON.stringify(value.transaction));
  writeFileSync(observations, JSON.stringify(value.observations));
  return { dir, transaction, observations, output, value };
}

test('Bitcoin Core import CLI emits deterministic non-authoritative evidence without broadcast', () => {
  const paths = files();
  execFileSync(process.execPath, ['scripts/verify-bitcoin-core-cross-check.js', '--transaction', paths.transaction, '--observations', paths.observations, '--output', paths.output], { cwd:process.cwd() });
  const evidence = JSON.parse(readFileSync(paths.output, 'utf8'));
  assert.equal(evidence.observationSource, 'imported-json');
  assert.equal(evidence.bitcoinCoreCrossCheckProven, false);
  assert.equal(evidence.signetExecutionProven, false);
  assert.equal(evidence.broadcastPerformed, false);
  assert.equal(evidence.chainPromotionAuthority, false);
});

test('Bitcoin Core import CLI rejects substitution, authority fields and overwrite', () => {
  const paths = files();
  const substituted = structuredClone(paths.value.observations);
  substituted.decodedTransaction.hash = '00'.repeat(32);
  writeFileSync(paths.observations, JSON.stringify(substituted));
  let result = spawnSync(process.execPath, ['scripts/verify-bitcoin-core-cross-check.js', '--transaction', paths.transaction, '--observations', paths.observations], { cwd:process.cwd(), encoding:'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /decoded wtxid/);

  paths.value.observations.observationSource = 'bitcoin-core-rpc';
  writeFileSync(paths.observations, JSON.stringify(paths.value.observations));
  result = spawnSync(process.execPath, ['scripts/verify-bitcoin-core-cross-check.js', '--transaction', paths.transaction, '--observations', paths.observations], { cwd:process.cwd(), encoding:'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fields must be exactly/);

  writeFileSync(paths.output, 'occupied');
  result = spawnSync(process.execPath, ['scripts/verify-bitcoin-core-cross-check.js', '--transaction', paths.transaction, '--observations', paths.observations, '--output', paths.output], { cwd:process.cwd(), encoding:'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(paths.output, 'utf8'), 'occupied');
});

test('Bitcoin Core import CLI rejects every secret-bearing argument', () => {
  const paths = files();
  for (const flag of ['--private-key', '--secret-key', '--seed', '--rpc-password', '--rpc-cookie', '--wallet', '--key-output']) {
    const result = spawnSync(process.execPath, ['scripts/verify-bitcoin-core-cross-check.js', '--transaction', paths.transaction, '--observations', paths.observations, flag, 'forbidden'], { cwd:process.cwd(), encoding:'utf8' });
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, /forbidden/, flag);
  }
});
