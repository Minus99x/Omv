import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2.js';

const HEX = /^(?:[0-9a-f]{2})+$/i;
const HEX_28 = /^[0-9a-f]{56}$/i;

function bytesFromHex(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!HEX.test(normalized)) throw new TypeError(`${label} must be non-empty even-length base16.`);
  return Uint8Array.from(Buffer.from(normalized, 'hex'));
}

function keyHash(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  if (!HEX_28.test(normalized)) throw new TypeError(`${label} must be 28-byte hex.`);
  return normalized;
}

function paymentKeyHashFromAddressBytes(addressBytes, label) {
  const decoded = Cardano.Address.from_bytes(addressBytes);
  if (decoded.network_id() !== 0) throw new Error(`${label} is not Cardano testnet/Preprod network id 0.`);
  const candidates = [
    Cardano.BaseAddress.from_address(decoded),
    Cardano.EnterpriseAddress.from_address(decoded),
    Cardano.PointerAddress.from_address(decoded)
  ].filter(Boolean);
  if (candidates.length !== 1) throw new Error(`${label} is not a supported Shelley spendable address.`);
  const hash = candidates[0].payment_cred().to_keyhash();
  if (!hash) throw new Error(`${label} is not controlled by a payment verification key.`);
  return hash.to_hex();
}

function optionalBytesHex(value) {
  return value == null ? null : Buffer.from(value.to_bytes()).toString('hex');
}

function walletNonVkeyFingerprint(witnessSet) {
  return Object.freeze({
    nativeScripts: optionalBytesHex(witnessSet.native_scripts()),
    bootstraps: optionalBytesHex(witnessSet.bootstraps()),
    plutusScripts: optionalBytesHex(witnessSet.plutus_scripts()),
    plutusData: optionalBytesHex(witnessSet.plutus_data()),
    redeemers: optionalBytesHex(witnessSet.redeemers())
  });
}

export function verifyCardanoCip30OwnerContext({
  networkId,
  addressHexes,
  expectedOwnerPaymentKeyHash
}) {
  if (networkId !== 0) throw new Error('Connected Lace wallet is not on Cardano Preprod/testnet network id 0. Network id must be the numeric value 0, not a coerced substitute.');
  if (!Array.isArray(addressHexes) || addressHexes.length < 1) {
    throw new Error('Connected Lace wallet did not expose any wallet addresses for owner verification.');
  }
  const expected = keyHash(expectedOwnerPaymentKeyHash, 'expectedOwnerPaymentKeyHash');
  const observed = [];
  for (const [index, addressHex] of addressHexes.entries()) {
    try {
      observed.push(paymentKeyHashFromAddressBytes(bytesFromHex(addressHex, `addressHexes[${index}]`), `addressHexes[${index}]`));
    } catch {}
  }
  if (!observed.includes(expected)) {
    throw new Error('Connected Lace account does not control the frozen initialize owner payment key.');
  }
  return Object.freeze({
    valid: true,
    networkId: 0,
    expectedOwnerPaymentKeyHash: expected,
    matchingOwnerPaymentKeyObserved: true,
    observedSpendableAddressCount: observed.length
  });
}

export function mergeCardanoCip30OwnerWitness({
  unsignedTransactionCborHex,
  walletWitnessSetCborHex,
  expectedOwnerPaymentKeyHash
}) {
  const expected = keyHash(expectedOwnerPaymentKeyHash, 'expectedOwnerPaymentKeyHash');
  const unsignedBytes = bytesFromHex(unsignedTransactionCborHex, 'unsignedTransactionCborHex');
  const walletWitnessBytes = bytesFromHex(walletWitnessSetCborHex, 'walletWitnessSetCborHex');

  const unsignedTx = Cardano.Transaction.from_bytes(unsignedBytes);
  if (unsignedTx.is_valid() !== true) {
    throw new Error('Frozen initialize transaction must carry a true transaction validity flag before wallet witness merge.');
  }
  const walletWitnessSet = Cardano.TransactionWitnessSet.from_bytes(walletWitnessBytes);
  const canonicalWalletWitnessHex = Buffer.from(walletWitnessSet.to_bytes()).toString('hex');
  if (canonicalWalletWitnessHex !== String(walletWitnessSetCborHex).toLowerCase()) {
    throw new Error('Wallet witness-set CBOR must round-trip canonically without byte substitution.');
  }

  const injected = walletNonVkeyFingerprint(walletWitnessSet);
  if (Object.values(injected).some(value => value != null)) {
    throw new Error('CIP-30 wallet response contains unexpected non-VKey witness material.');
  }

  const walletVkeys = walletWitnessSet.vkeys();
  if (!walletVkeys || walletVkeys.len() !== 1) {
    throw new Error('CIP-30 wallet response must contain exactly one owner VKey witness.');
  }
  const witness = walletVkeys.get(0);
  const publicKey = witness.vkey().public_key();
  const ownerPaymentKeyHash = publicKey.hash().to_hex();
  if (ownerPaymentKeyHash !== expected) {
    throw new Error('CIP-30 wallet witness public key does not match the frozen owner payment key.');
  }

  const bodyHashBytes = blake2b(unsignedTx.body().to_bytes(), { dkLen: 32 });
  if (!publicKey.verify(bodyHashBytes, witness.signature())) {
    throw new Error('CIP-30 wallet witness signature is invalid for the frozen transaction body.');
  }

  const originalWitnessSet = unsignedTx.witness_set();
  if (originalWitnessSet.vkeys() != null) {
    throw new Error('Frozen initialize transaction unexpectedly already contains wallet VKey witnesses.');
  }
  const mergedWitnessSet = Cardano.TransactionWitnessSet.from_bytes(originalWitnessSet.to_bytes());
  mergedWitnessSet.set_vkeys(walletVkeys);

  const signedTx = Cardano.Transaction.new(
    unsignedTx.body(),
    mergedWitnessSet,
    unsignedTx.auxiliary_data()
  );
  if (signedTx.body().to_hex() !== unsignedTx.body().to_hex()) {
    throw new Error('CIP-30 witness merge changed the frozen transaction body.');
  }
  if (signedTx.is_valid() !== unsignedTx.is_valid()) {
    throw new Error('CIP-30 witness merge changed the transaction validity flag.');
  }

  const signedTransactionCborHex = signedTx.to_hex();
  return Object.freeze({
    signedTransactionCborHex,
    transactionBodyHash: Buffer.from(bodyHashBytes).toString('hex'),
    ownerPaymentKeyHash,
    witnessCount: 1,
    walletWitnessSetCborHex: canonicalWalletWitnessHex,
    walletWitnessSetSha256: createHash('sha256').update(Buffer.from(canonicalWalletWitnessHex, 'hex')).digest('hex'),
    signedTransactionSha256: createHash('sha256').update(Buffer.from(signedTransactionCborHex, 'hex')).digest('hex'),
    exactFrozenBodyPreserved: true,
    walletWitnessSignatureVerified: true,
    submissionPerformed: false,
    submissionAuthorized: false
  });
}
