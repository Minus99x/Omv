import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, Wallet } from 'xrpl';
import { encodeAndVerifyXrplMultisign } from '../src/chains/xrpl/codec.js';

const wallet = byte => Wallet.fromEntropy(Uint8Array.from({ length: 16 }, () => byte));
const owner = wallet(1);
const contactA = wallet(2);
const contactB = wallet(3);
const rescue = wallet(4);
const signerList = {
  owner: owner.address,
  signerEntries: [{ account: contactA.address, weight: 1 }, { account: contactB.address, weight: 1 }],
  quorum: 2
};
const transaction = Object.freeze({
  TransactionType: 'Payment',
  Account: owner.address,
  Destination: rescue.address,
  Amount: '1000000',
  Sequence: 0,
  TicketSequence: 55,
  Fee: '30',
  LastLedgerSequence: 1000,
  SigningPubKey: ''
});

function signatureFrom(signer, tx = transaction) {
  const decoded = decode(signer.sign(tx, true).tx_blob);
  const value = decoded.Signers[0].Signer;
  return Object.freeze({ account: value.Account, signingPubKey: value.SigningPubKey, txnSignature: value.TxnSignature });
}

test('XRPL pinned codec verifies signer preimages and emits canonical multisigned binary', () => {
  const result = encodeAndVerifyXrplMultisign({
    transaction,
    signerList,
    signatures: [signatureFrom(contactA), signatureFrom(contactB)],
    baseFeeDrops: '10'
  });
  assert.match(result.transactionBlob, /^[0-9A-F]+$/);
  assert.match(result.transactionHash, /^[0-9A-F]{64}$/);
  assert.equal(result.signedWeight, 2);
  assert.equal(result.minimumFeeDrops, '30');
  assert.equal(result.roundTripExact, true);
  assert.equal(result.cryptographicVerificationComplete, true);
  assert.equal(result.liveSubmissionReady, false);
  assert.equal(result.signedTransaction.SigningPubKey, '');
  assert.equal(result.signedTransaction.TxnSignature, undefined);
});

test('XRPL codec canonicalizes reverse-provided signatures by numeric AccountID', () => {
  const forward = encodeAndVerifyXrplMultisign({ transaction, signerList, signatures: [signatureFrom(contactA), signatureFrom(contactB)], baseFeeDrops: '10' });
  const reverse = encodeAndVerifyXrplMultisign({ transaction, signerList, signatures: [signatureFrom(contactB), signatureFrom(contactA)], baseFeeDrops: '10' });
  assert.equal(reverse.transactionBlob, forward.transactionBlob);
  assert.deepEqual(reverse.signerAccounts, forward.signerAccounts);
});

test('XRPL codec rejects a signature after any frozen transaction field changes', () => {
  const signatures = [signatureFrom(contactA), signatureFrom(contactB)];
  assert.throws(() => encodeAndVerifyXrplMultisign({ transaction: { ...transaction, Amount: '1000001' }, signerList, signatures, baseFeeDrops: '10' }), /failed XRPL multisignature/);
  assert.throws(() => encodeAndVerifyXrplMultisign({ transaction: { ...transaction, LastLedgerSequence: 1001 }, signerList, signatures, baseFeeDrops: '10' }), /failed XRPL multisignature/);
});

test('XRPL codec binds each public key to its declared signer account', () => {
  const a = signatureFrom(contactA);
  const b = signatureFrom(contactB);
  assert.throws(() => encodeAndVerifyXrplMultisign({ transaction, signerList, signatures: [{ ...a, signingPubKey: b.signingPubKey }, b], baseFeeDrops: '10' }), /does not derive/);
});

test('XRPL canonical codec retains coordinator quorum and fee gates', () => {
  const a = signatureFrom(contactA);
  const b = signatureFrom(contactB);
  assert.throws(() => encodeAndVerifyXrplMultisign({ transaction, signerList, signatures: [a], baseFeeDrops: '10' }), /does not meet quorum/);
  assert.throws(() => encodeAndVerifyXrplMultisign({ transaction: { ...transaction, Fee: '29' }, signerList, signatures: [signatureFrom(contactA, { ...transaction, Fee: '29' }), signatureFrom(contactB, { ...transaction, Fee: '29' })], baseFeeDrops: '10' }), /minimum/);
});
