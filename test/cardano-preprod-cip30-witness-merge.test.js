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

function unsignedTransactionHex({ networkId = 0, requiredSignerHashes = [ownerKeyHash] } = {}) {
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
  body.set_network_id(networkId === 0 ? Cardano.NetworkId.testnet() : Cardano.NetworkId.mainnet());
  const signers = Cardano.Ed25519KeyHashes.new();
  for (const hash of requiredSignerHashes) signers.add(Cardano.Ed25519KeyHash.from_hex(hash));
  body.set_required_signers(signers);
  return Cardano.Transaction.new(body, Cardano.TransactionWitnessSet.new()).to_hex();
}

function walletWitnessSetHex(privateKey = ownerPrivateKey, transactionCborHex = unsignedTransactionHex()) {
  const tx = Cardano.Transaction.from_hex(transactionCborHex);
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(tx.body().to_bytes(), { dkLen: 32 }));
  const vkeys = Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash, privateKey));
  const witnesses = Cardano.TransactionWitnessSet.new();
  witnesses.set_vkeys(vkeys);
  return Buffer.from(witnesses.to_bytes()).toString('hex');
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


test('CIP-30 owner context rejects coerced or missing network identifiers', () => {
  const addressHex = Buffer.from(ownerAddress.to_bytes()).toString('hex');
  for (const networkId of ['0', '', ' 0 ', null, undefined, false, [], [0], 0n, new Number(0)]) {
    assert.throws(
      () => verifyCardanoCip30OwnerContext({
        networkId,
        addressHexes: [addressHex],
        expectedOwnerPaymentKeyHash: ownerKeyHash
      }),
      /numeric value 0/
    );
  }
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


test('CIP-30 owner witness merge rejects an invalid frozen transaction even with a well-formed wallet witness', () => {
  const invalidTx = Cardano.Transaction.from_hex(unsignedTransactionHex());
  invalidTx.set_is_valid(false);
  assert.throws(
    () => mergeCardanoCip30OwnerWitness({
      unsignedTransactionCborHex: invalidTx.to_hex(),
      walletWitnessSetCborHex: walletWitnessSetHex(),
      expectedOwnerPaymentKeyHash: ownerKeyHash
    }),
    /must carry a true transaction validity flag/
  );
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

test('CIP-30 owner witness merge rejects a non-Preprod transaction even with a valid owner witness', () => {
  const nonPreprodTransaction = unsignedTransactionHex({ networkId: 1 });
  assert.throws(
    () => mergeCardanoCip30OwnerWitness({
      unsignedTransactionCborHex: nonPreprodTransaction,
      walletWitnessSetCborHex: walletWitnessSetHex(ownerPrivateKey, nonPreprodTransaction),
      expectedOwnerPaymentKeyHash: ownerKeyHash
    }),
    /must target Cardano Preprod\/testnet network id 0/
  );
});

test('CIP-30 owner witness merge rejects extra required signers even with a valid owner witness', () => {
  const extraSigner = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 10)).to_public().hash().to_hex();
  const transactionWithExtraSigner = unsignedTransactionHex({
    requiredSignerHashes: [ownerKeyHash, extraSigner]
  });
  assert.throws(
    () => mergeCardanoCip30OwnerWitness({
      unsignedTransactionCborHex: transactionWithExtraSigner,
      walletWitnessSetCborHex: walletWitnessSetHex(ownerPrivateKey, transactionWithExtraSigner),
      expectedOwnerPaymentKeyHash: ownerKeyHash
    }),
    /require exactly the owner payment key/
  );
});

test('CIP-30 owner witness merge rejects non-canonical transaction CBOR', () => {
  const canonicalTransaction = unsignedTransactionHex();
  const transactionBytes = Buffer.from(canonicalTransaction, 'hex');
  assert.equal(transactionBytes[0], 0x84, 'fixture uses a four-element transaction array');
  const nonCanonicalTransaction = Buffer.concat([
    Buffer.from([0x98, 0x04]),
    transactionBytes.subarray(1)
  ]).toString('hex');
  assert.throws(
    () => mergeCardanoCip30OwnerWitness({
      unsignedTransactionCborHex: nonCanonicalTransaction,
      walletWitnessSetCborHex: walletWitnessSetHex(ownerPrivateKey, canonicalTransaction),
      expectedOwnerPaymentKeyHash: ownerKeyHash
    }),
    /must round-trip canonically/
  );
});

test('CIP-30 owner witness merge rejects injected non-VKey witness material', () => {
  const tx = Cardano.Transaction.from_hex(unsignedTransactionHex());
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(tx.body().to_bytes(), { dkLen: 32 }));
  const vkeys = Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash, ownerPrivateKey));
  const witnesses = Cardano.TransactionWitnessSet.new();
  witnesses.set_vkeys(vkeys);
  const nativeScripts = Cardano.NativeScripts.new();
  nativeScripts.add(Cardano.NativeScript.new_script_pubkey(
    Cardano.ScriptPubkey.new(Cardano.Ed25519KeyHash.from_hex('ab'.repeat(28)))
  ));
  witnesses.set_native_scripts(nativeScripts);

  assert.throws(
    () => mergeCardanoCip30OwnerWitness({
      unsignedTransactionCborHex: unsignedTransactionHex(),
      walletWitnessSetCborHex: Buffer.from(witnesses.to_bytes()).toString('hex'),
      expectedOwnerPaymentKeyHash: ownerKeyHash
    }),
    /unexpected non-VKey/
  );
});
