/** Optional REAL Scalus validation, not a stub. Run only after installing scalus@1.3.0. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { CardanoInfo, Emulator, Utxo, Value } from 'scalus';

const TEST_TXID = 'ab'.repeat(32);
const SLOT = 135700000;
const COIN = 1_000_000_000n;
const privateKey = CSL.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 9));
const ownerAddress = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(privateKey.to_public().hash())).to_address();
const address = ownerAddress.to_bech32();

function localEmulator(slot = SLOT) {
  // Separate, disposable ledger for each test: no provider and no public network.
  return Emulator.create(CardanoInfo.preprod(), {
    slot,
    utxos: [new Utxo(TEST_TXID, 0, address, new Value(COIN))]
  });
}

function signedPayment({ fee = 200_000n, ttl = SLOT + 100, signed = true } = {}) {
  const ins = CSL.TransactionInputs.new();
  ins.add(CSL.TransactionInput.new(CSL.TransactionHash.from_hex(TEST_TXID), 0));
  const outs = CSL.TransactionOutputs.new();
  outs.add(CSL.TransactionOutput.new(ownerAddress, CSL.Value.new(CSL.BigNum.from_str((COIN - fee).toString()))));
  const body = CSL.TransactionBody.new(ins, outs, CSL.BigNum.from_str(fee.toString()), ttl);
  body.set_validity_start_interval(SLOT - 10);
  const witnessSet = CSL.TransactionWitnessSet.new();
  if (signed) {
    const witnesses = CSL.Vkeywitnesses.new();
    const bodyHash = CSL.TransactionHash.from_bytes(blake2b(body.to_bytes(), { dkLen: 32 }));
    witnesses.add(CSL.make_vkey_witness(bodyHash, privateKey));
    witnessSet.set_vkeys(witnesses);
  }
  return CSL.Transaction.new(body, witnessSet, undefined).to_bytes();
}

test('Scalus Preprod emulator accepts a properly signed CSL test-only spend, then rejects replay', () => {
  const emulator = localEmulator();
  const bytes = signedPayment();
  const accepted = emulator.submitTx(bytes);
  assert.equal(accepted.isSuccess, true, `${accepted.errorRule ?? ''}: ${accepted.error ?? ''}`);
  assert.match(accepted.txHash, /^[0-9a-f]{64}$/i);
  const replay = emulator.submitTx(bytes);
  assert.equal(replay.isSuccess, false, 'same input was spent and must not be accepted twice');
});

test('Scalus Preprod emulator rejects a transaction without the required payment witness', () => {
  const emulator = localEmulator();
  const denied = emulator.submitTx(signedPayment({ signed: false }));
  assert.equal(denied.isSuccess, false);
});

test('Scalus Preprod emulator rejects an expired validity interval', () => {
  const emulator = localEmulator(SLOT + 101);
  const denied = emulator.submitTx(signedPayment());
  assert.equal(denied.isSuccess, false);
});

test('Scalus Preprod emulator enforces the minimum transaction fee', () => {
  const emulator = localEmulator();
  const denied = emulator.submitTx(signedPayment({ fee: 1n }));
  assert.equal(denied.isSuccess, false);
});
