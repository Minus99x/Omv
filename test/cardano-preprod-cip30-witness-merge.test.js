import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import {
  mergeCardanoCip30OwnerWitness,
  verifyCardanoCip30OwnerContext
} from '../src/chains/cardano/preprod-cip30-witness-merge.js';

const ownerPrivateKey = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 9));
const ownerPublicKey = ownerPrivateKey.to_public();
const ownerKeyHash = ownerPublicKey.hash().to_hex();
const ownerAddress = Cardano.BaseAddress.new(
  0,
  Cardano.Credential.from_keyhash(ownerPublicKey.hash()),
  Cardano.Credential.from_keyhash(ownerPublicKey.hash())
).to_address();

function unsignedTransactionHex() {
  const input = Cardano.TransactionInput.new(
    Cardano.TransactionHash.from_hex('11'.repeat(32)),
    0
  );
  const inputs = Cardano.TransactionInputs.new();
  inputs.add(input);
  const outputs = Cardano.TransactionOutputs.new();
  outputs.add(Cardano.TransactionOutput.new(
    ownerAddress,
    Cardano.Value.new(Cardano.BigNum.from_str('5000000'))
  ));
  const body = Cardano.TransactionBody.new_tx_body(
    inputs,
    outputs,
    Cardano.BigNum.from_str('200000')
  );
  body.set_network_id(Cardano.NetworkId.testnet());
  const signers = Cardano.Ed25519KeyHashes.new();
  signers.add(ownerPublicKey.hash());
  body.set_required_signers(signers);
  return Cardano.Transaction.new(body, Cardano.TransactionWitnessSet.new()).to_hex();
}

function walletWitnessSetHex(privateKey = ownerPrivateKey) {
  const tx = Cardano.Transaction.from_hex(unsignedTransactionHex());
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(tx.body().to_bytes(), { dkLen: 32 }));
  const vkeys = Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash, privateKey));
  const witnesses = Cardano.TransactionWitnessSet.new();
  witnesses.set_vkeys(vkeys);
  return witnesses.to_hex();
}

test('CIP-30 owner context requires Preprod and the frozen owner payment key', () => {
  const addressHex = Buffer.from(ownerAddress.to_bytes()).toString('hex');
  const result = verifyCardanoCip30OwnerContext({
    networkId: 0,
    addressHexes: [addressHex],
    expectedOwnerPaymentKeyHash: ownerKeyHash
  });
  assert.equal(result.valid, true);
  assert.equal(result.matchingOwnerPaymentKeyObserved, true);

  assert.throws(
    () => verifyCardanoCip30OwnerContext({
      networkId: 1,
      addressHexes: [addressHex],
      expectedOwnerPaymentKeyHash: ownerKeyHash
    }),
    /not on Cardano Preprod/
  );
  assert.throws(
    () => verifyCardanoCip30OwnerContext({
      networkId: 0,
      addressHexes: [addressHex],
      expectedOwnerPaymentKeyHash: 'aa'.repeat(28)
    }),
    /does not control/
  );
});

test('CIP-30 owner witness merge preserves the frozen body and verifies the owner signature', () => {
  const unsignedTransactionCborHex = unsignedTransactionHex();
  const result = mergeCardanoCip30OwnerWitness({
    unsignedTransactionCborHex,
    walletWitnessSetCborHex: walletWitnessSetHex(),
    expectedOwnerPaymentKeyHash: ownerKeyHash
  });
  const unsignedTx = Cardano.Transaction.from_hex(unsignedTransactionCborHex);
  const signedTx = Cardano.Transaction.from_hex(result.signedTransactionCborHex);
  assert.equal(signedTx.body().to_hex(), unsignedTx.body().to_hex());
  assert.equal(signedTx.witness_set().vkeys().len(), 1);
  assert.equal(result.ownerPaymentKeyHash, ownerKeyHash);
  assert.equal(result.witnessCount, 1);
  assert.equal(result.exactFrozenBodyPreserved, true);
  assert.equal(result.walletWitnessSignatureVerified, true);
  assert.equal(result.submissionPerformed, false);
  assert.equal(result.submissionAuthorized, false);
});

test('CIP-30 owner witness merge rejects the wrong signer', () => {
  const wrongKey = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 10));
  assert.throws(
    () => mergeCardanoCip30OwnerWitness({
      unsignedTransactionCborHex: unsignedTransactionHex(),
      walletWitnessSetCborHex: walletWitnessSetHex(wrongKey),
      expectedOwnerPaymentKeyHash: ownerKeyHash
    }),
    /does not match/
  );
});

test('CIP-30 owner witness merge rejects injected non-VKey witness material', () => {
  const tx = Cardano.Transaction.from_hex(unsignedTransactionHex());
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(tx.body().to_bytes(), { dkLen: 32 }));
  const vkeys = Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash, ownerPrivateKey));
  const witnesses = Cardano.TransactionWitnessSet.new();
  witnesses.set_vkeys(vkeys);
  witnesses.set_redeemers(Cardano.Redeemers.new());

  assert.throws(
    () => mergeCardanoCip30OwnerWitness({
      unsignedTransactionCborHex: unsignedTransactionHex(),
      walletWitnessSetCborHex: witnesses.to_hex(),
      expectedOwnerPaymentKeyHash: ownerKeyHash
    }),
    /unexpected non-VKey/
  );
});
