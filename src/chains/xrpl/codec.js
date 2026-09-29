import {
  decode,
  decodeAccountID,
  deriveAddress,
  encode,
  encodeForMultiSigning,
  hashes,
  multisign,
  verifyKeypairSignature
} from 'xrpl';
import { coordinateXrplMultisign } from './signer-list.js';

const HEX = /^(?:[0-9A-F]{2})+$/;

function frozenBaseTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) throw new TypeError('transaction is required.');
  const result = { ...transaction, SigningPubKey: '' };
  delete result.TxnSignature;
  delete result.Signers;
  return Object.freeze(result);
}

function compareAccounts(left, right) {
  return Buffer.compare(Buffer.from(decodeAccountID(left)), Buffer.from(decodeAccountID(right)));
}

function validateSignature(signature, index, transaction) {
  const account = signature?.account;
  const signingPubKey = signature?.signingPubKey;
  const txnSignature = signature?.txnSignature;
  if (typeof signingPubKey !== 'string' || !HEX.test(signingPubKey)) throw new TypeError(`signatures[${index}].signingPubKey must be canonical hex.`);
  if (typeof txnSignature !== 'string' || !HEX.test(txnSignature)) throw new TypeError(`signatures[${index}].txnSignature must be canonical hex.`);
  if (deriveAddress(signingPubKey) !== account) throw new Error(`signatures[${index}] public key does not derive the declared signer account.`);
  const preimage = encodeForMultiSigning(transaction, account);
  if (!verifyKeypairSignature(preimage, txnSignature, signingPubKey)) throw new Error(`signatures[${index}] failed XRPL multisignature verification.`);
  return Object.freeze({ account, signingPubKey, txnSignature, preimage });
}

export function encodeAndVerifyXrplMultisign({ transaction, signerList, signatures, baseFeeDrops }) {
  const base = frozenBaseTransaction(transaction);
  const coordinated = coordinateXrplMultisign({ transaction: base, signerList, signatures, baseFeeDrops });
  const verified = signatures.map((signature, index) => validateSignature(signature, index, base));
  const partialTransactions = verified.map(signature => ({
    ...base,
    Signers: [{ Signer: { Account: signature.account, SigningPubKey: signature.signingPubKey, TxnSignature: signature.txnSignature } }]
  }));
  const transactionBlob = multisign(partialTransactions);
  const signedTransaction = decode(transactionBlob);
  if (signedTransaction.SigningPubKey !== '' || signedTransaction.TxnSignature != null) throw new Error('Canonical XRPL multisign transaction has invalid top-level signing fields.');
  if (!Array.isArray(signedTransaction.Signers) || signedTransaction.Signers.length !== verified.length) throw new Error('Canonical XRPL multisign transaction lost signer entries.');

  const orderedAccounts = signedTransaction.Signers.map(item => item.Signer.Account);
  const expectedOrder = [...orderedAccounts].sort(compareAccounts);
  if (orderedAccounts.some((account, index) => account !== expectedOrder[index])) throw new Error('XRPL codec did not emit canonical numeric Account ordering.');
  if (encode(signedTransaction) !== transactionBlob) throw new Error('XRPL multisigned binary did not round-trip canonically.');

  return Object.freeze({
    transactionBlob,
    transactionHash: hashes.hashSignedTx(transactionBlob),
    signedTransaction: Object.freeze(signedTransaction),
    signerAccounts: Object.freeze(orderedAccounts),
    signerPreimages: Object.freeze(verified.map(item => Object.freeze({ account: item.account, preimage: item.preimage }))),
    signedWeight: coordinated.signedWeight,
    quorum: coordinated.quorum,
    minimumFeeDrops: coordinated.minimumFeeDrops,
    roundTripExact: true,
    cryptographicVerificationComplete: true,
    liveSubmissionReady: false
  });
}
