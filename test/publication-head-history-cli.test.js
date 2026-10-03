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
import { createPublicationHeadReceipt } from '../src/core/publication-head-receipt.js';

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
  const firstAnchor=anchorFixture('0.6.45-dev','1','2026-10-03T15:01:00.000Z');
  const secondAnchor=anchorFixture('0.6.46-dev','2','2026-10-03T15:02:00.000Z');
  const first=createPublicationHeadReceipt({history:firstAnchor.history,historySnapshot:firstAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T15:03:00.000Z'});
  const second=createPublicationHeadReceipt({history:secondAnchor.history,historySnapshot:secondAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T15:04:00.000Z'});

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
});

test('publication receipt verifier can require the supplied receipt to be current in publication history',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publication-current-'));
  const firstAnchor=anchorFixture('0.6.45-dev','1','2026-10-03T15:11:00.000Z');
  const secondAnchor=anchorFixture('0.6.46-dev','2','2026-10-03T15:12:00.000Z');
  const first=createPublicationHeadReceipt({history:firstAnchor.history,historySnapshot:firstAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T15:13:00.000Z'});
  const second=createPublicationHeadReceipt({history:secondAnchor.history,historySnapshot:secondAnchor.snapshot,publisher:'release-registry',publishedAt:'2026-10-03T15:14:00.000Z'});

  const files={
    first:path.join(dir,'first.json'),second:path.join(dir,'second.json'),
    anchorHistory:path.join(dir,'anchor-history.json'),anchorSnapshot:path.join(dir,'anchor-snapshot.json'),
    publicationHistory:path.join(dir,'publication-history.json'),publicationSnapshot:path.join(dir,'publication-snapshot.json')
  };
  fs.writeFileSync(files.first,JSON.stringify(first));
  fs.writeFileSync(files.second,JSON.stringify(second));
  fs.writeFileSync(files.anchorHistory,JSON.stringify(secondAnchor.history));
  fs.writeFileSync(files.anchorSnapshot,JSON.stringify(secondAnchor.snapshot));

  const history1=path.join(dir,'history-1.json');
  const snapshot1=path.join(dir,'snapshot-1.json');
  assert.equal(run('scripts/append-publication-head-history.js',['--receipt',files.first,'--output',history1,'--snapshot-output',snapshot1]).status,0);
  assert.equal(run('scripts/append-publication-head-history.js',['--receipt',files.second,'--history',history1,'--output',files.publicationHistory,'--snapshot-output',files.publicationSnapshot]).status,0);

  const common=['--anchor-history',files.anchorHistory,'--anchor-history-snapshot',files.anchorSnapshot,'--publication-history',files.publicationHistory,'--publication-history-snapshot',files.publicationSnapshot];
  const accepted=run('scripts/verify-publication-head-receipt.js',['--receipt',files.second,...common]);
  assert.equal(accepted.status,0,accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).publicationReceiptCurrent,true);

  const rejected=run('scripts/verify-publication-head-receipt.js',['--receipt',files.first,...common]);
  assert.equal(rejected.status,1);
  assert.equal(JSON.parse(rejected.stdout).publicationReceiptCurrent,false);
});
