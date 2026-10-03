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

function run(script,args) { return spawnSync(process.execPath,[script,...args],{cwd:process.cwd(),encoding:'utf8'}); }
function index(ref,byte) { const core={schema:'omegavault.external-review-index.v1',checkpoint:{ref,archiveFilename:`${ref}.zip`,archiveSha256:byte.repeat(64)}}; return {...core,sha256:evidenceDigest(core)}; }

test('policy-anchor history CLIs append safely and reject an old current anchor', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-anchor-history-'));
  const key=generateKeyPairSync('ed25519');
  const trustHistory=[createReviewerTrustEvent({reviewer:'audit-team',publicKey:key.publicKey,action:'enroll',configuredBy:'policy',configuredAt:'2026-10-03T06:00:00Z'})];
  const trustSnapshot=createReviewerTrustHistorySnapshot(trustHistory);
  const anchor=(ref,byte,time)=>createReviewerTrustPolicyAnchor({externalReviewIndex:index(ref,byte),trustHistory,trustHistorySnapshot:trustSnapshot,anchoredBy:'registry',anchoredAt:time});
  const first=anchor('0.6.44-dev','1','2026-10-03T06:01:00Z');
  const second=anchor('0.6.45-dev','2','2026-10-03T06:02:00Z');
  const files={first:path.join(dir,'first.json'),second:path.join(dir,'second.json'),history1:path.join(dir,'history-1.json'),snapshot1:path.join(dir,'snapshot-1.json'),history2:path.join(dir,'history-2.json'),snapshot2:path.join(dir,'snapshot-2.json')};
  fs.writeFileSync(files.first,JSON.stringify(first)); fs.writeFileSync(files.second,JSON.stringify(second));
  const append1=run('scripts/append-reviewer-trust-policy-anchor-history.js',['--anchor',files.first,'--output',files.history1,'--snapshot-output',files.snapshot1]);
  assert.equal(append1.status,0,append1.stderr);
  const append2=run('scripts/append-reviewer-trust-policy-anchor-history.js',['--anchor',files.second,'--history',files.history1,'--output',files.history2,'--snapshot-output',files.snapshot2]);
  assert.equal(append2.status,0,append2.stderr);
  assert.equal(JSON.parse(append2.stdout).entryCount,2);
  const verifyCurrent=run('scripts/verify-reviewer-trust-policy-anchor-history.js',['--anchor',files.second,'--history',files.history2,'--history-snapshot',files.snapshot2]);
  assert.equal(verifyCurrent.status,0,verifyCurrent.stderr);
  assert.equal(JSON.parse(verifyCurrent.stdout).current,true);
  const verifyOld=run('scripts/verify-reviewer-trust-policy-anchor-history.js',['--anchor',files.first,'--history',files.history2,'--history-snapshot',files.snapshot2]);
  assert.equal(verifyOld.status,1);
  assert.equal(JSON.parse(verifyOld.stdout).current,false);
  const overwrite=run('scripts/append-reviewer-trust-policy-anchor-history.js',['--anchor',files.second,'--history',files.history1,'--output',files.history2,'--snapshot-output',path.join(dir,'unused.json')]);
  assert.equal(overwrite.status,1);
});

test('policy-anchor history append preflights both outputs and leaves no partial history', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-anchor-history-preflight-'));
  const key=generateKeyPairSync('ed25519');
  const trustHistory=[createReviewerTrustEvent({reviewer:'audit-team',publicKey:key.publicKey,action:'enroll',configuredBy:'policy',configuredAt:'2026-10-03T23:00:00Z'})];
  const trustSnapshot=createReviewerTrustHistorySnapshot(trustHistory);
  const anchor=createReviewerTrustPolicyAnchor({
    externalReviewIndex:index('0.6.47-dev','4'),
    trustHistory,
    trustHistorySnapshot:trustSnapshot,
    anchoredBy:'registry',
    anchoredAt:'2026-10-03T23:01:00Z'
  });
  const anchorPath=path.join(dir,'anchor.json');
  const historyOutput=path.join(dir,'history.json');
  const existingSnapshot=path.join(dir,'existing-snapshot.json');
  fs.writeFileSync(anchorPath,JSON.stringify(anchor));
  fs.writeFileSync(existingSnapshot,'already here');

  const collision=run('scripts/append-reviewer-trust-policy-anchor-history.js',[
    '--anchor',anchorPath,'--output',historyOutput,'--snapshot-output',existingSnapshot
  ]);
  assert.equal(collision.status,1);
  assert.match(collision.stderr,/snapshot output already exists/i);
  assert.equal(fs.existsSync(historyOutput),false);

  const samePath=path.join(dir,'same.json');
  const same=run('scripts/append-reviewer-trust-policy-anchor-history.js',[
    '--anchor',anchorPath,'--output',samePath,'--snapshot-output',samePath
  ]);
  assert.equal(same.status,1);
  assert.match(same.stderr,/different paths/i);
  assert.equal(fs.existsSync(samePath),false);
});
