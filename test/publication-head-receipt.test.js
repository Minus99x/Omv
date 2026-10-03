import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { evidenceDigest } from '../src/core/evidence.js';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';
import { createReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';
import { createReviewerTrustPolicyAnchorHistoryEntry, createReviewerTrustPolicyAnchorHistorySnapshot } from '../src/core/reviewer-trust-policy-anchor-history.js';
import {
  createDetachedPublicationHeadReceiptSignature,
  createPublicationHeadReceipt,
  verifyDetachedPublicationHeadReceiptSignature,
  verifyPublicationHeadReceipt
} from '../src/core/publication-head-receipt.js';

function reviewIndex(ref, byte) {
  const core={schema:'omegavault.external-review-index.v1',checkpoint:{ref,archiveFilename:`${ref}.zip`,archiveSha256:byte.repeat(64)},checkpointManifest:{logicalSha256:'22'.repeat(32)},reviewBasis:{sha256:'33'.repeat(32)},verification:{sourceAncestryInference:false}};
  return {...core,sha256:evidenceDigest(core)};
}
function fixture() {
  const reviewerKey=generateKeyPairSync('ed25519');
  const trustHistory=[createReviewerTrustEvent({reviewer:'audit-team',publicKey:reviewerKey.publicKey,action:'enroll',configuredBy:'policy',configuredAt:'2026-10-03T10:00:00.000Z'})];
  const trustSnapshot=createReviewerTrustHistorySnapshot(trustHistory);
  const firstAnchor=createReviewerTrustPolicyAnchor({externalReviewIndex:reviewIndex('0.6.44-dev','1'),trustHistory,trustHistorySnapshot:trustSnapshot,anchoredBy:'registry',anchoredAt:'2026-10-03T10:01:00.000Z'});
  const secondAnchor=createReviewerTrustPolicyAnchor({externalReviewIndex:reviewIndex('0.6.45-dev','2'),trustHistory,trustHistorySnapshot:trustSnapshot,anchoredBy:'registry',anchoredAt:'2026-10-03T10:02:00.000Z'});
  const firstEntry=createReviewerTrustPolicyAnchorHistoryEntry({anchor:firstAnchor});
  const secondEntry=createReviewerTrustPolicyAnchorHistoryEntry({anchor:secondAnchor,previousEntry:firstEntry});
  const history=[firstEntry,secondEntry];
  return {history,snapshot:createReviewerTrustPolicyAnchorHistorySnapshot(history),oldHistory:[firstEntry],oldSnapshot:createReviewerTrustPolicyAnchorHistorySnapshot([firstEntry])};
}

test('unsigned publication receipt binds the exact current anchor-history head with no added authority', () => {
  const {history,snapshot}=fixture();
  const receipt=createPublicationHeadReceipt({history,historySnapshot:snapshot,publisher:'independent-release-registry',publishedAt:'2026-10-03T10:03:00.000Z'});
  assert.equal(receipt.signatureStatus,'unsigned');
  assert.equal(receipt.anchorHistory.snapshotSha256,snapshot.sha256);
  assert.equal(receipt.anchorHistory.headEntrySha256,snapshot.headEntrySha256);
  assert.equal(receipt.anchorHistory.headAnchorSha256,snapshot.headAnchorSha256);
  assert.deepEqual(Object.values(receipt.authority).filter(value=>typeof value==='boolean'),[false,false,false,false,false,false,false]);
  assert.equal(verifyPublicationHeadReceipt(receipt,{history,historySnapshot:snapshot}).ok,true);
});

test('stale histories, substituted heads, publisher tampering and altered authority fail closed', () => {
  const {history,snapshot,oldHistory,oldSnapshot}=fixture();
  const oldReceipt=createPublicationHeadReceipt({history:oldHistory,historySnapshot:oldSnapshot,publisher:'registry',publishedAt:'2026-10-03T10:03:00.000Z'});
  assert.equal(verifyPublicationHeadReceipt(oldReceipt,{history,historySnapshot:snapshot}).ok,false);
  const receipt=createPublicationHeadReceipt({history,historySnapshot:snapshot,publisher:'registry',publishedAt:'2026-10-03T10:03:00.000Z'});
  const substituted=structuredClone(receipt); substituted.anchorHistory.headAnchorSha256='aa'.repeat(32); substituted.sha256=evidenceDigest(Object.fromEntries(Object.entries(substituted).filter(([key])=>key!=='sha256')));
  assert.equal(verifyPublicationHeadReceipt(substituted,{history,historySnapshot:snapshot}).ok,false);
  const publisherTampered=structuredClone(receipt); publisherTampered.publisher='attacker';
  assert.equal(verifyPublicationHeadReceipt(publisherTampered,{history,historySnapshot:snapshot}).ok,false);
  const elevated=structuredClone(receipt); elevated.authority.walletAuthority=true; elevated.sha256=evidenceDigest(Object.fromEntries(Object.entries(elevated).filter(([key])=>key!=='sha256')));
  assert.equal(verifyPublicationHeadReceipt(elevated,{history,historySnapshot:snapshot}).ok,false);
});

test('publication receipt and detached signature reject non-canonical extra fields', () => {
  const { history, snapshot } = fixture();
  const receipt=createPublicationHeadReceipt({history,historySnapshot:snapshot,publisher:'release-registry',publishedAt:'2026-10-03T14:05:00.000Z'});
  const extraReceipt=structuredClone(receipt);
  extraReceipt.anchorHistory.unexpected='ambiguous';
  extraReceipt.sha256=evidenceDigest(Object.fromEntries(Object.entries(extraReceipt).filter(([key])=>key!=='sha256')));
  assert.equal(verifyPublicationHeadReceipt(extraReceipt,{history,historySnapshot:snapshot}).ok,false);

  const key=generateKeyPairSync('ed25519');
  const signature=createDetachedPublicationHeadReceiptSignature({receipt,privateKey:key.privateKey});
  const extraSignature=structuredClone(signature);
  extraSignature.unexpected=false;
  extraSignature.sha256=evidenceDigest(Object.fromEntries(Object.entries(extraSignature).filter(([field])=>field!=='sha256')));
  assert.equal(verifyDetachedPublicationHeadReceiptSignature(extraSignature,receipt,key.publicKey).authenticated,false);
});

test('detached publisher authentication is valid only for the exact receipt and public key', () => {
  const {history,snapshot}=fixture();
  const receipt=createPublicationHeadReceipt({history,historySnapshot:snapshot,publisher:'registry',publishedAt:'2026-10-03T10:03:00.000Z'});
  const publisherKey=generateKeyPairSync('ed25519');
  const otherKey=generateKeyPairSync('ed25519');
  const signature=createDetachedPublicationHeadReceiptSignature({receipt,privateKey:publisherKey.privateKey});
  assert.equal(verifyDetachedPublicationHeadReceiptSignature(signature,receipt,publisherKey.publicKey).authenticated,true);
  assert.equal(verifyDetachedPublicationHeadReceiptSignature(signature,receipt,otherKey.publicKey).authenticated,false);
  const otherReceipt=createPublicationHeadReceipt({history,historySnapshot:snapshot,publisher:'registry',publishedAt:'2026-10-03T10:04:00.000Z'});
  assert.equal(verifyDetachedPublicationHeadReceiptSignature(signature,otherReceipt,publisherKey.publicKey).authenticated,false);
  const elevated=structuredClone(signature); elevated.authority.reviewerTrust=true; elevated.sha256=evidenceDigest(Object.fromEntries(Object.entries(elevated).filter(([key])=>key!=='sha256')));
  assert.equal(verifyDetachedPublicationHeadReceiptSignature(elevated,receipt,publisherKey.publicKey).authenticated,false);
});
