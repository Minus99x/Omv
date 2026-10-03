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
import { createDetachedPublicationHeadReceiptSignature, createPublicationHeadReceipt } from '../src/core/publication-head-receipt.js';
import { createPublisherTrustEvent, createPublisherTrustHistorySnapshot } from '../src/core/publisher-trust-history.js';

function run(script,args){return spawnSync(process.execPath,[script,...args],{cwd:process.cwd(),encoding:'utf8'});}
function index(ref,byte){const core={schema:'omegavault.external-review-index.v1',checkpoint:{ref,archiveFilename:`${ref}.zip`,archiveSha256:byte.repeat(64)},checkpointManifest:{logicalSha256:'22'.repeat(32)},reviewBasis:{sha256:'33'.repeat(32)},verification:{sourceAncestryInference:false}};return {...core,sha256:evidenceDigest(core)};}

function anchorFixture(ref,byte,anchorTime){
  const reviewerKey=generateKeyPairSync('ed25519');
  const trustHistory=[createReviewerTrustEvent({reviewer:'audit-team',publicKey:reviewerKey.publicKey,action:'enroll',configuredBy:'policy',configuredAt:'2026-10-03T15:00:00.000Z'})];
  const trustSnapshot=createReviewerTrustHistorySnapshot(trustHistory);
  const anchor=createReviewerTrustPolicyAnchor({externalReviewIndex:index(ref,byte),trustHistory,trustHistorySnapshot:trustSnapshot,anchoredBy:'registry',anchoredAt:anchorTime});
  const history=[createReviewerTrustPolicyAnchorHistoryEntry({anchor})];
  return {history,snapshot:createReviewerTrustPolicyAnchorHistorySnapshot(history)};
}

test('publication-history CLIs append successors and reject an old publication as current',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publication-history-'));
  const currentAnchor=anchorFixture('0.6.46-dev','2','2026-10-03T15:02:00.000Z');
  const first=createPublicationHeadReceipt({history:currentAnchor.history,historySnapshot:currentAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T15:03:00.000Z'});
  const second=createPublicationHeadReceipt({history:currentAnchor.history,historySnapshot:currentAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T15:04:00.000Z'});

  const files={
    first:path.join(dir,'first.json'),
    second:path.join(dir,'second.json'),
    history1:path.join(dir,'history-1.json'),
    snapshot1:path.join(dir,'snapshot-1.json'),
    history2:path.join(dir,'history-2.json'),
    snapshot2:path.join(dir,'snapshot-2.json')
  };
  fs.writeFileSync(files.first,JSON.stringify(first));
  fs.writeFileSync(files.second,JSON.stringify(second));

  const append1=run('scripts/append-publication-head-history.js',['--receipt',files.first,'--output',files.history1,'--snapshot-output',files.snapshot1]);
  assert.equal(append1.status,0,append1.stderr);

  const append2=run('scripts/append-publication-head-history.js',['--receipt',files.second,'--history',files.history1,'--output',files.history2,'--snapshot-output',files.snapshot2]);
  assert.equal(append2.status,0,append2.stderr);
  assert.equal(JSON.parse(append2.stdout).entryCount,2);

  const verifyCurrent=run('scripts/verify-publication-head-history.js',['--receipt',files.second,'--history',files.history2,'--history-snapshot',files.snapshot2]);
  assert.equal(verifyCurrent.status,0,verifyCurrent.stderr);
  assert.equal(JSON.parse(verifyCurrent.stdout).current,true);

  const verifyOld=run('scripts/verify-publication-head-history.js',['--receipt',files.first,'--history',files.history2,'--history-snapshot',files.snapshot2]);
  assert.equal(verifyOld.status,1);
  assert.equal(JSON.parse(verifyOld.stdout).current,false);

  const overwrite=run('scripts/append-publication-head-history.js',['--receipt',files.second,'--history',files.history1,'--output',files.history2,'--snapshot-output',path.join(dir,'unused.json')]);
  assert.equal(overwrite.status,1);

  const secretRejected=run('scripts/append-publication-head-history.js',['--receipt',files.second,'--history',files.history1,'--output',path.join(dir,'secret-history.json'),'--snapshot-output',path.join(dir,'secret-snapshot.json'),'--private-key',path.join(dir,'publisher-private.pem')]);
  assert.equal(secretRejected.status,2);
  assert.match(secretRejected.stderr,/secret input is forbidden/i);

  const verifySecretRejected=run('scripts/verify-publication-head-history.js',['--receipt',files.second,'--history',files.history2,'--history-snapshot',files.snapshot2,'--seed','not-a-real-seed']);
  assert.equal(verifySecretRejected.status,2);
  assert.match(verifySecretRejected.stderr,/secret input is forbidden/i);
});

test('publication receipt verifier can require the supplied receipt to be current in publication history',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publication-current-'));
  const currentAnchor=anchorFixture('0.6.46-dev','2','2026-10-03T15:12:00.000Z');
  const first=createPublicationHeadReceipt({history:currentAnchor.history,historySnapshot:currentAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T15:13:00.000Z'});
  const second=createPublicationHeadReceipt({history:currentAnchor.history,historySnapshot:currentAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T15:14:00.000Z'});

  const files={
    first:path.join(dir,'first.json'),second:path.join(dir,'second.json'),
    anchorHistory:path.join(dir,'anchor-history.json'),anchorSnapshot:path.join(dir,'anchor-snapshot.json'),
    publicationHistory:path.join(dir,'publication-history.json'),publicationSnapshot:path.join(dir,'publication-snapshot.json'),
    firstSignature:path.join(dir,'first-signature.json'),secondSignature:path.join(dir,'second-signature.json'),publisherKey:path.join(dir,'publisher-public.pem')
  };
  fs.writeFileSync(files.first,JSON.stringify(first));
  fs.writeFileSync(files.second,JSON.stringify(second));
  fs.writeFileSync(files.anchorHistory,JSON.stringify(currentAnchor.history));
  fs.writeFileSync(files.anchorSnapshot,JSON.stringify(currentAnchor.snapshot));

  const history1=path.join(dir,'history-1.json');
  const snapshot1=path.join(dir,'snapshot-1.json');
  assert.equal(run('scripts/append-publication-head-history.js',['--receipt',files.first,'--output',history1,'--snapshot-output',snapshot1]).status,0);
  assert.equal(run('scripts/append-publication-head-history.js',['--receipt',files.second,'--history',history1,'--output',files.publicationHistory,'--snapshot-output',files.publicationSnapshot]).status,0);

  const publisherKey=generateKeyPairSync('ed25519');
  fs.writeFileSync(files.publisherKey,publisherKey.publicKey.export({type:'spki',format:'pem'}));
  fs.writeFileSync(files.firstSignature,JSON.stringify(createDetachedPublicationHeadReceiptSignature({receipt:first,privateKey:publisherKey.privateKey})));
  fs.writeFileSync(files.secondSignature,JSON.stringify(createDetachedPublicationHeadReceiptSignature({receipt:second,privateKey:publisherKey.privateKey})));

  const common=['--anchor-history',files.anchorHistory,'--anchor-history-snapshot',files.anchorSnapshot,'--publication-history',files.publicationHistory,'--publication-history-snapshot',files.publicationSnapshot,'--public-key',files.publisherKey,'--require-authenticated-publisher'];
  const accepted=run('scripts/verify-publication-head-receipt.js',['--receipt',files.second,'--signature',files.secondSignature,...common]);
  assert.equal(accepted.status,0,accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).publisherAuthenticated,true);
  assert.equal(JSON.parse(accepted.stdout).publicationReceiptCurrent,true);

  const rejected=run('scripts/verify-publication-head-receipt.js',['--receipt',files.first,'--signature',files.firstSignature,...common]);
  assert.equal(rejected.status,1);
  assert.equal(JSON.parse(rejected.stdout).publisherAuthenticated,true);
  assert.equal(JSON.parse(rejected.stdout).publicationReceiptCurrent,false);
});


test('publication verifier distinguishes authenticated publisher from separately trusted publisher',()=> {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publisher-trust-'));
  const currentAnchor=anchorFixture('0.6.47-dev','4','2026-10-03T20:00:00.000Z');
  const receipt=createPublicationHeadReceipt({history:currentAnchor.history,historySnapshot:currentAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T20:01:00.000Z'});
  const first=generateKeyPairSync('ed25519');
  const second=generateKeyPairSync('ed25519');
  const signature=createDetachedPublicationHeadReceiptSignature({receipt,privateKey:first.privateKey});
  const enroll=createPublisherTrustEvent({publisher:'release-registry',publicKey:first.publicKey,action:'enroll',configuredBy:'release-policy',configuredAt:'2026-10-03T20:02:00.000Z'});
  const rotate=createPublisherTrustEvent({publisher:'release-registry',publicKey:second.publicKey,action:'rotate',configuredBy:'release-policy',configuredAt:'2026-10-03T20:03:00.000Z',previousEvent:enroll});
  const trustedHistory=[enroll];
  const rotatedHistory=[enroll,rotate];

  const files={
    receipt:path.join(dir,'receipt.json'),signature:path.join(dir,'signature.json'),publicKey:path.join(dir,'publisher-public.pem'),
    anchorHistory:path.join(dir,'anchor-history.json'),anchorSnapshot:path.join(dir,'anchor-snapshot.json'),
    trustedHistory:path.join(dir,'trusted-history.json'),trustedSnapshot:path.join(dir,'trusted-snapshot.json'),
    rotatedHistory:path.join(dir,'rotated-history.json'),rotatedSnapshot:path.join(dir,'rotated-snapshot.json')
  };
  fs.writeFileSync(files.receipt,JSON.stringify(receipt));
  fs.writeFileSync(files.signature,JSON.stringify(signature));
  fs.writeFileSync(files.publicKey,first.publicKey.export({type:'spki',format:'pem'}));
  fs.writeFileSync(files.anchorHistory,JSON.stringify(currentAnchor.history));
  fs.writeFileSync(files.anchorSnapshot,JSON.stringify(currentAnchor.snapshot));
  fs.writeFileSync(files.trustedHistory,JSON.stringify(trustedHistory));
  fs.writeFileSync(files.trustedSnapshot,JSON.stringify(createPublisherTrustHistorySnapshot(trustedHistory)));
  fs.writeFileSync(files.rotatedHistory,JSON.stringify(rotatedHistory));
  fs.writeFileSync(files.rotatedSnapshot,JSON.stringify(createPublisherTrustHistorySnapshot(rotatedHistory)));

  const common=['--receipt',files.receipt,'--signature',files.signature,'--public-key',files.publicKey,'--anchor-history',files.anchorHistory,'--anchor-history-snapshot',files.anchorSnapshot,'--require-authenticated-publisher','--require-trusted-publisher'];

  const trusted=run('scripts/verify-publication-head-receipt.js',[...common,'--publisher-trust-history',files.trustedHistory,'--publisher-trust-history-snapshot',files.trustedSnapshot]);
  assert.equal(trusted.status,0,trusted.stderr);
  const trustedOutput=JSON.parse(trusted.stdout);
  assert.equal(trustedOutput.publisherAuthenticated,true);
  assert.equal(trustedOutput.publisherTrusted,true);
  assert.equal(trustedOutput.publisherTrustDecision,'trusted-authenticated');

  const rotated=run('scripts/verify-publication-head-receipt.js',[...common,'--publisher-trust-history',files.rotatedHistory,'--publisher-trust-history-snapshot',files.rotatedSnapshot]);
  assert.equal(rotated.status,1);
  const rotatedOutput=JSON.parse(rotated.stdout);
  assert.equal(rotatedOutput.publisherAuthenticated,true);
  assert.equal(rotatedOutput.publisherTrusted,false);
  assert.equal(rotatedOutput.publisherTrustDecision,'authenticated-untrusted');

  const secretRejected=run('scripts/append-publisher-trust-event.js',['--publisher','release-registry','--public-key',files.publicKey,'--action','enroll','--configured-by','release-policy','--configured-at','2026-10-03T20:04:00.000Z','--output',path.join(dir,'forbidden.json'),'--private-key',path.join(dir,'publisher-private.pem')]);
  assert.equal(secretRejected.status,1);
  assert.match(secretRejected.stderr,/secret input .* forbidden/i);
});

test('publication verifier requires complete publisher-trust configuration when trust is required',()=> {
  const missingTrust=run('scripts/verify-publication-head-receipt.js',[
    '--receipt','missing.json',
    '--anchor-history','missing-history.json',
    '--anchor-history-snapshot','missing-snapshot.json',
    '--require-trusted-publisher'
  ]);
  assert.equal(missingTrust.status,2);
  assert.match(missingTrust.stderr,/Usage:/);

  const missingSignature=run('scripts/verify-publication-head-receipt.js',[
    '--receipt','missing.json',
    '--anchor-history','missing-history.json',
    '--anchor-history-snapshot','missing-snapshot.json',
    '--publisher-trust-history','missing-trust.json',
    '--publisher-trust-history-snapshot','missing-trust-snapshot.json',
    '--require-trusted-publisher'
  ]);
  assert.equal(missingSignature.status,2);
  assert.match(missingSignature.stderr,/Usage:/);

  const halfTrust=run('scripts/verify-publication-head-receipt.js',[
    '--receipt','missing.json',
    '--anchor-history','missing-history.json',
    '--anchor-history-snapshot','missing-snapshot.json',
    '--signature','missing-signature.json',
    '--public-key','missing-key.pem',
    '--publisher-trust-history','missing-trust.json'
  ]);
  assert.equal(halfTrust.status,2);
  assert.match(halfTrust.stderr,/Usage:/);
});

test('publication verifier explicitly rejects secret-bearing arguments',()=> {
  for (const forbidden of ['private-key','secret-key','seed','key-output']) {
    const result=run('scripts/verify-publication-head-receipt.js',[
      '--receipt','missing.json',
      '--anchor-history','missing-history.json',
      '--anchor-history-snapshot','missing-snapshot.json',
      `--${forbidden}`,'secret'
    ]);
    assert.equal(result.status,2);
    assert.match(result.stderr,/secret input .* forbidden/i);
  }
});
