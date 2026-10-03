import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { evidenceDigest } from '../src/core/evidence.js';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';
import { createReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';
import { createReviewerTrustPolicyAnchorHistoryEntry, createReviewerTrustPolicyAnchorHistorySnapshot } from '../src/core/reviewer-trust-policy-anchor-history.js';
import { createDetachedPublicationHeadReceiptSignature, createPublicationHeadReceipt } from '../src/core/publication-head-receipt.js';
import {
  assessPublisherTrustHistory,
  createPublisherTrustEvent,
  createPublisherTrustHistorySnapshot,
  verifyPublisherTrustHistory,
  verifyPublisherTrustHistorySnapshot
} from '../src/core/publisher-trust-history.js';

function reviewIndex(ref, byte) {
  const core={schema:'omegavault.external-review-index.v1',checkpoint:{ref,archiveFilename:`${ref}.zip`,archiveSha256:byte.repeat(64)},checkpointManifest:{logicalSha256:'22'.repeat(32)},reviewBasis:{sha256:'33'.repeat(32)},verification:{sourceAncestryInference:false}};
  return {...core,sha256:evidenceDigest(core)};
}
function publicationReceipt() {
  const reviewerKey=generateKeyPairSync('ed25519');
  const reviewerHistory=[createReviewerTrustEvent({reviewer:'audit-team',publicKey:reviewerKey.publicKey,action:'enroll',configuredBy:'policy',configuredAt:'2026-10-03T18:00:00.000Z'})];
  const reviewerSnapshot=createReviewerTrustHistorySnapshot(reviewerHistory);
  const anchor=createReviewerTrustPolicyAnchor({externalReviewIndex:reviewIndex('0.6.47-dev','4'),trustHistory:reviewerHistory,trustHistorySnapshot:reviewerSnapshot,anchoredBy:'registry',anchoredAt:'2026-10-03T18:01:00.000Z'});
  const entry=createReviewerTrustPolicyAnchorHistoryEntry({anchor});
  const history=[entry];
  const snapshot=createReviewerTrustPolicyAnchorHistorySnapshot(history);
  return createPublicationHeadReceipt({history,historySnapshot:snapshot,publisher:'release-registry',publishedAt:'2026-10-03T18:02:00.000Z'});
}
function trustFixture() {
  const first=generateKeyPairSync('ed25519');
  const second=generateKeyPairSync('ed25519');
  const enroll=createPublisherTrustEvent({publisher:'release-registry',publicKey:first.publicKey,action:'enroll',configuredBy:'release-policy',configuredAt:'2026-10-03T18:03:00.000Z',reason:'initial publisher key'});
  const rotate=createPublisherTrustEvent({publisher:'release-registry',publicKey:second.publicKey,action:'rotate',configuredBy:'release-policy',configuredAt:'2026-10-03T18:04:00.000Z',previousEvent:enroll,reason:'scheduled rotation'});
  return {first,second,enroll,rotate};
}

test('publisher trust history binds enrollment and rotation without conflating signature authentication', () => {
  const {first,second,enroll,rotate}=trustFixture();
  const verification=verifyPublisherTrustHistory([enroll,rotate]);
  assert.equal(verification.ok,true);
  assert.equal(verification.status,'trusted');
  assert.equal(verification.currentKeySpkiSha256,rotate.publicKeySpkiSha256);
  assert.notEqual(first.publicKey,second.publicKey);
});

test('valid old publisher signature remains authenticated but untrusted after rotation', () => {
  const {first,second,enroll,rotate}=trustFixture();
  const receipt=publicationReceipt();
  const oldSignature=createDetachedPublicationHeadReceiptSignature({receipt,privateKey:first.privateKey});
  const currentSignature=createDetachedPublicationHeadReceiptSignature({receipt,privateKey:second.privateKey});

  const oldResult=assessPublisherTrustHistory({receipt,signature:oldSignature,publicKey:first.publicKey,trustHistory:[enroll,rotate]});
  assert.equal(oldResult.signatureAuthenticated,true);
  assert.equal(oldResult.publisherTrusted,false);
  assert.equal(oldResult.decision,'authenticated-untrusted');

  const currentResult=assessPublisherTrustHistory({receipt,signature:currentSignature,publicKey:second.publicKey,trustHistory:[enroll,rotate]});
  assert.equal(currentResult.ok,true);
  assert.equal(currentResult.publisherTrusted,true);
  assert.equal(currentResult.decision,'trusted-authenticated');
});

test('publisher revocation is terminal and valid signatures from revoked key are untrusted', () => {
  const {second,enroll,rotate}=trustFixture();
  const revoke=createPublisherTrustEvent({publisher:'release-registry',publicKey:second.publicKey,action:'revoke',configuredBy:'release-policy',configuredAt:'2026-10-03T18:05:00.000Z',previousEvent:rotate,reason:'publisher access ended'});
  const receipt=publicationReceipt();
  const signature=createDetachedPublicationHeadReceiptSignature({receipt,privateKey:second.privateKey});
  const result=assessPublisherTrustHistory({receipt,signature,publicKey:second.publicKey,trustHistory:[enroll,rotate,revoke]});
  assert.equal(result.signatureAuthenticated,true);
  assert.equal(result.publisherTrusted,false);
  assert.equal(result.trustStatus,'revoked');
  assert.throws(()=>createPublisherTrustEvent({publisher:'release-registry',publicKey:second.publicKey,action:'rotate',configuredBy:'release-policy',configuredAt:'2026-10-03T18:06:00.000Z',previousEvent:revoke}),/follow revocation/);
});

test('publisher trust history fails closed for rollback, reorder, skipped links and identity changes', () => {
  const {second,enroll,rotate}=trustFixture();
  const snapshot=createPublisherTrustHistorySnapshot([enroll,rotate]);
  assert.equal(verifyPublisherTrustHistorySnapshot(snapshot,[enroll,rotate]).ok,true);
  assert.equal(verifyPublisherTrustHistorySnapshot(snapshot,[enroll]).ok,false);
  assert.equal(verifyPublisherTrustHistory([rotate,enroll]).ok,false);
  assert.equal(verifyPublisherTrustHistory([enroll,{...rotate,sequence:3}]).ok,false);
  const tampered=structuredClone(rotate); tampered.previousEventSha256='ff'.repeat(32);
  assert.equal(verifyPublisherTrustHistory([enroll,tampered]).ok,false);
  assert.throws(()=>createPublisherTrustEvent({publisher:'other-registry',publicKey:second.publicKey,action:'revoke',configuredBy:'release-policy',configuredAt:'2026-10-03T18:05:00.000Z',previousEvent:rotate}),/identity must remain constant/);
});

test('publisher trust metadata rejects authority elevation and non-canonical fields', () => {
  const {enroll}=trustFixture();
  const elevated=structuredClone(enroll);
  elevated.authority.walletAuthority=true;
  elevated.sha256=evidenceDigest(Object.fromEntries(Object.entries(elevated).filter(([key])=>key!=='sha256')));
  assert.equal(verifyPublisherTrustHistory([elevated]).ok,false);

  const extra=structuredClone(enroll);
  extra.unexpected='ambiguous';
  extra.sha256=evidenceDigest(Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='sha256')));
  assert.equal(verifyPublisherTrustHistory([extra]).ok,false);
});
