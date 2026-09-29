import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decode, Wallet } from 'xrpl';
import { encodeAndVerifyXrplMultisign } from '../src/chains/xrpl/codec.js';

const evidenceUrl = new URL('../docs/evidence/XRPL_MULTISIGN_CODEC_0.6.15.json', import.meta.url);
const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
const wallet = byte => Wallet.fromEntropy(Uint8Array.from({ length: 16 }, () => byte));
const [owner, contactA, contactB, rescue] = [1, 2, 3, 4].map(wallet);

assert.equal(evidence.fixture, 'synthetic-non-deployable');
assert.deepEqual(evidence.library, { name: 'xrpl', version: '4.6.0' });
assert.equal(owner.address, evidence.transaction.Account);
assert.equal(rescue.address, evidence.transaction.Destination);

function signatureFrom(signer) {
  const signerEntry = decode(signer.sign(evidence.transaction, true).tx_blob).Signers[0].Signer;
  return {
    account: signerEntry.Account,
    signingPubKey: signerEntry.SigningPubKey,
    txnSignature: signerEntry.TxnSignature
  };
}

const result = encodeAndVerifyXrplMultisign({
  transaction: evidence.transaction,
  signerList: evidence.signerList,
  signatures: [signatureFrom(contactA), signatureFrom(contactB)],
  baseFeeDrops: '10'
});
const sha256Hex = value => createHash('sha256').update(Buffer.from(value, 'hex')).digest('hex');

assert.deepEqual(result.signerAccounts, evidence.signerAccounts);
assert.deepEqual(result.signerPreimages.map(item => ({
  account: item.account,
  sha256: sha256Hex(item.preimage),
  byteLength: item.preimage.length / 2
})), evidence.signingPreimages);
assert.deepEqual({
  sha256: sha256Hex(result.transactionBlob),
  byteLength: result.transactionBlob.length / 2
}, evidence.transactionBlob);
assert.equal(result.transactionHash, evidence.transactionHash);
assert.equal(result.signedWeight, evidence.signedWeight);
assert.equal(result.quorum, evidence.quorum);
assert.equal(result.minimumFeeDrops, evidence.minimumFeeDrops);
assert.equal(result.roundTripExact, evidence.roundTripExact);
assert.equal(result.cryptographicVerificationComplete, evidence.cryptographicVerificationComplete);
assert.equal(result.liveSubmissionReady, evidence.liveSubmissionReady);

console.log(`XRPL codec evidence verified: ${result.transactionHash}`);
