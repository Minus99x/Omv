import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { evidenceDigest } from '../src/core/evidence.js';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';
import { createReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';
import { createReviewerTrustPolicyAnchorHistoryEntry, createReviewerTrustPolicyAnchorHistorySnapshot } from '../src/core/reviewer-trust-policy-anchor-history.js';
import { createDetachedPublicationHeadReceiptSignature } from '../src/core/publication-head-receipt.js';

function run(script,args) { return spawnSync(process.execPath,[script,...args],{cwd:process.cwd(),encoding:'utf8'}); }
function filesFixture(dir) {
  const reviewerKey=generateKeyPairSync('ed25519');
  const indexCore={schema:'omegavault.external-review-index.v1',checkpoint:{ref:'0.6.45-dev',archiveFilename:'checkpoint.zip',archiveSha256:'11'.repeat(32)},checkpointManifest:{logicalSha256:'22'.repeat(32)},reviewBasis:{sha256:'33'.repeat(32)},verification:{sourceAncestryInference:false}};
  const index={...indexCore,sha256:evidenceDigest(indexCore)};
  const trustHistory=[createReviewerTrustEvent({reviewer:'audit-team',publicKey:reviewerKey.publicKey,action:'enroll',configuredBy:'policy',configuredAt:'2026-10-03T10:00:00.000Z'})];
  const trustSnapshot=createReviewerTrustHistorySnapshot(trustHistory);
  const anchor=createReviewerTrustPolicyAnchor({externalReviewIndex:index,trustHistory,trustHistorySnapshot:trustSnapshot,anchoredBy:'registry',anchoredAt:'2026-10-03T10:01:00.000Z'});
  const history=[createReviewerTrustPolicyAnchorHistoryEntry({anchor})];
  const snapshot=createReviewerTrustPolicyAnchorHistorySnapshot(history);
  const files={history:path.join(dir,'history.json'),snapshot:path.join(dir,'snapshot.json'),receipt:path.join(dir,'publication.json'),signature:path.join(dir,'signature.json'),publicKey:path.join(dir,'publisher-public.pem')};
  fs.writeFileSync(files.history,JSON.stringify(history)); fs.writeFileSync(files.snapshot,JSON.stringify(snapshot));
  return files;
}

test('publication receipt CLIs protect output and never accept publisher secrets', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publication-'));
  const files=filesFixture(dir);
  const createArgs=['--anchor-history',files.history,'--anchor-history-snapshot',files.snapshot,'--publisher','release-registry','--published-at','2026-10-03T10:02:00.000Z','--output',files.receipt];
  const created=run('scripts/create-publication-head-receipt.js',createArgs);
  assert.equal(created.status,0,created.stderr);
  assert.equal(JSON.parse(created.stdout).publisherSecretHandled,false);
  assert.equal(JSON.parse(fs.readFileSync(files.receipt,'utf8')).signatureStatus,'unsigned');
  assert.equal(run('scripts/create-publication-head-receipt.js',createArgs).status,1);
  const forbidden=run('scripts/create-publication-head-receipt.js',[...createArgs,'--private-key',path.join(dir,'secret.pem')]);
  assert.equal(forbidden.status,2);
  assert.match(forbidden.stderr,/secret input is forbidden/i);
  const verified=run('scripts/verify-publication-head-receipt.js',['--receipt',files.receipt,'--anchor-history',files.history,'--anchor-history-snapshot',files.snapshot]);
  assert.equal(verified.status,0,verified.stderr);
  assert.equal(JSON.parse(verified.stdout).current,true);
});

test('verify CLI authenticates only an exact detached publisher signature', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publication-auth-'));
  const files=filesFixture(dir);
  const created=run('scripts/create-publication-head-receipt.js',['--anchor-history',files.history,'--anchor-history-snapshot',files.snapshot,'--publisher','release-registry','--published-at','2026-10-03T10:02:00.000Z','--output',files.receipt]);
  assert.equal(created.status,0,created.stderr);
  const publisherKey=generateKeyPairSync('ed25519');
  const receipt=JSON.parse(fs.readFileSync(files.receipt,'utf8'));
  fs.writeFileSync(files.signature,JSON.stringify(createDetachedPublicationHeadReceiptSignature({receipt,privateKey:publisherKey.privateKey})));
  fs.writeFileSync(files.publicKey,publisherKey.publicKey.export({type:'spki',format:'pem'}));
  const args=['--receipt',files.receipt,'--anchor-history',files.history,'--anchor-history-snapshot',files.snapshot,'--signature',files.signature,'--public-key',files.publicKey,'--require-authenticated-publisher'];
  const verified=run('scripts/verify-publication-head-receipt.js',args);
  assert.equal(verified.status,0,verified.stderr);
  assert.equal(JSON.parse(verified.stdout).publisherAuthenticated,true);
  const wrongKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}); fs.writeFileSync(files.publicKey,wrongKey);
  assert.equal(run('scripts/verify-publication-head-receipt.js',args).status,1);
});
