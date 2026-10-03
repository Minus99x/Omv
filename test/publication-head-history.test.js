import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { evidenceDigest } from '../src/core/evidence.js';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';
import { createReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';
import { createReviewerTrustPolicyAnchorHistoryEntry, createReviewerTrustPolicyAnchorHistorySnapshot } from '../src/core/reviewer-trust-policy-anchor-history.js';
import { createPublicationHeadReceipt } from '../src/core/publication-head-receipt.js';
import {
  createPublicationHeadHistoryEntry,
  createPublicationHeadHistorySnapshot,
  verifyCurrentPublicationHeadReceipt,
  verifyPublicationHeadHistory,
  verifyPublicationHeadHistorySnapshot
} from '../src/core/publication-head-history.js';

function reviewIndex(ref,byte) {
  const core={schema:'omegavault.external-review-index.v1',checkpoint:{ref,archiveFilename:`${ref}.zip`,archiveSha256:byte.repeat(64)},checkpointManifest:{logicalSha256:'22'.repeat(32)},reviewBasis:{sha256:'33'.repeat(32)},verification:{sourceAncestryInference:false}};
  return {...core,sha256:evidenceDigest(core)};
}

function anchorHistory(ref,byte,time) {
  const reviewerKey=generateKeyPairSync('ed25519');
  const trustHistory=[createReviewerTrustEvent({reviewer:'audit-team',publicKey:reviewerKey.publicKey,action:'enroll',configuredBy:'policy',configuredAt:'2026-10-03T14:00:00.000Z'})];
  const trustSnapshot=createReviewerTrustHistorySnapshot(trustHistory);
  const anchor=createReviewerTrustPolicyAnchor({externalReviewIndex:reviewIndex(ref,byte),trustHistory,trustHistorySnapshot:trustSnapshot,anchoredBy:'registry',anchoredAt:time});
  const history=[createReviewerTrustPolicyAnchorHistoryEntry({anchor})];
  return {history,snapshot:createReviewerTrustPolicyAnchorHistorySnapshot(history)};
}

function fixture() {
  const firstAnchor=anchorHistory('0.6.45-dev','1','2026-10-03T14:01:00.000Z');
  const secondAnchor=anchorHistory('0.6.46-dev','2','2026-10-03T14:02:00.000Z');
  const first=createPublicationHeadReceipt({history:firstAnchor.history,historySnapshot:firstAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T14:03:00.000Z'});
  const second=createPublicationHeadReceipt({history:secondAnchor.history,historySnapshot:secondAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T14:04:00.000Z'});
  const firstEntry=createPublicationHeadHistoryEntry({receipt:first});
  const secondEntry=createPublicationHeadHistoryEntry({receipt:second,previousEntry:firstEntry});
  const history=[firstEntry,secondEntry];
  return {first,second,firstEntry,secondEntry,history,snapshot:createPublicationHeadHistorySnapshot(history)};
}

test('publication history binds each receipt to its exact predecessor and current head', () => {
  const {second,firstEntry,secondEntry,history,snapshot}=fixture();
  assert.equal(secondEntry.sequence,2);
  assert.equal(secondEntry.previousEntrySha256,firstEntry.sha256);
  assert.equal(secondEntry.previousPublicationReceiptSha256,firstEntry.publicationReceiptSha256);
  assert.equal(snapshot.headPublicationReceiptSha256,second.sha256);
  assert.equal(verifyPublicationHeadHistory(history).ok,true);
  assert.equal(verifyPublicationHeadHistorySnapshot(snapshot,history).ok,true);
  assert.equal(verifyCurrentPublicationHeadReceipt({receipt:second,history,historySnapshot:snapshot}).current,true);
});

test('older valid publication receipt is rejected when current publication history is supplied', () => {
  const {first,history,snapshot}=fixture();
  const result=verifyCurrentPublicationHeadReceipt({receipt:first,history,historySnapshot:snapshot});
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(error=>/current publication-history head/i.test(error)));
});

test('rollback, reorder, skipped links, duplicate receipts, publisher changes and timestamps fail closed', () => {
  const {firstEntry,secondEntry,history,snapshot}=fixture();
  assert.equal(verifyPublicationHeadHistorySnapshot(snapshot,[firstEntry]).ok,false);
  assert.equal(verifyPublicationHeadHistory([secondEntry,firstEntry]).ok,false);

  const skipped=structuredClone(secondEntry);
  skipped.previousEntrySha256='ab'.repeat(32);
  skipped.sha256=evidenceDigest(Object.fromEntries(Object.entries(skipped).filter(([key])=>key!=='sha256')));
  assert.equal(verifyPublicationHeadHistory([firstEntry,skipped]).ok,false);

  const duplicate=structuredClone(secondEntry);
  duplicate.publicationReceiptSha256=firstEntry.publicationReceiptSha256;
  duplicate.sha256=evidenceDigest(Object.fromEntries(Object.entries(duplicate).filter(([key])=>key!=='sha256')));
  assert.equal(verifyPublicationHeadHistory([firstEntry,duplicate]).ok,false);

  const changed=structuredClone(secondEntry);
  changed.publisher='other-registry';
  changed.sha256=evidenceDigest(Object.fromEntries(Object.entries(changed).filter(([key])=>key!=='sha256')));
  assert.equal(verifyPublicationHeadHistory([firstEntry,changed]).ok,false);

  assert.equal(verifyPublicationHeadHistory(history).ok,true);
});

test('duplicate and non-increasing publication receipts cannot be appended', () => {
  const {first,firstEntry}=fixture();
  assert.throws(()=>createPublicationHeadHistoryEntry({receipt:first,previousEntry:firstEntry}),/same receipt twice/i);
  const older=structuredClone(first);
  older.publishedAt='2026-10-03T14:02:59.000Z';
  older.sha256=evidenceDigest(Object.fromEntries(Object.entries(older).filter(([key])=>key!=='sha256')));
  assert.throws(()=>createPublicationHeadHistoryEntry({receipt:older,previousEntry:firstEntry}),/increase strictly/i);
});
