import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { evidenceDigest } from '../src/core/evidence.js';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';

function run(script, args) { return spawnSync(process.execPath, [script, ...args], { cwd:process.cwd(), encoding:'utf8' }); }

test('trust-policy anchor CLI creates and verifies a public audit sidecar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-policy-anchor-'));
  const key = generateKeyPairSync('ed25519');
  const event = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:key.publicKey, action:'enroll', configuredBy:'test-policy', configuredAt:'2026-10-03T06:00:00Z' });
  const history = [event];
  const snapshot = createReviewerTrustHistorySnapshot(history);
  const indexCore = { schema:'omegavault.external-review-index.v1', checkpoint:{ref:'0.6.43-dev',archiveFilename:'archive.zip',archiveSha256:'11'.repeat(32)}, checkpointManifest:{logicalSha256:'22'.repeat(32)}, reviewBasis:{sha256:'33'.repeat(32)}, verification:{sourceAncestryInference:false} };
  const index = { ...indexCore, sha256:evidenceDigest(indexCore) };
  const files = { index:path.join(dir,'index.json'), history:path.join(dir,'history.json'), snapshot:path.join(dir,'snapshot.json'), anchor:path.join(dir,'anchor.json') };
  fs.writeFileSync(files.index, JSON.stringify(index)); fs.writeFileSync(files.history, JSON.stringify(history)); fs.writeFileSync(files.snapshot, JSON.stringify(snapshot));
  const create = run('scripts/create-reviewer-trust-policy-anchor.js',['--external-review-index',files.index,'--trust-history',files.history,'--trust-history-snapshot',files.snapshot,'--anchored-by','test-registry','--anchored-at','2026-10-03T06:01:00Z','--output',files.anchor]);
  assert.equal(create.status, 0, create.stderr);
  assert.equal(JSON.parse(create.stdout).promotionAuthority, false);
  const verify = run('scripts/verify-reviewer-trust-policy-anchor.js',['--anchor',files.anchor,'--external-review-index',files.index,'--trust-history',files.history,'--trust-history-snapshot',files.snapshot]);
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).ok, true);
});

test('trust-policy anchor CLI rejects substituted review index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-policy-anchor-reject-'));
  const key = generateKeyPairSync('ed25519');
  const event = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:key.publicKey, action:'enroll', configuredBy:'test-policy', configuredAt:'2026-10-03T06:00:00Z' });
  const history = [event]; const snapshot = createReviewerTrustHistorySnapshot(history);
  const makeIndex = ref => { const core={ schema:'omegavault.external-review-index.v1', checkpoint:{ref,archiveFilename:'archive.zip',archiveSha256:'11'.repeat(32)} }; return {...core,sha256:evidenceDigest(core)}; };
  const files = { index:path.join(dir,'index.json'), other:path.join(dir,'other.json'), history:path.join(dir,'history.json'), snapshot:path.join(dir,'snapshot.json'), anchor:path.join(dir,'anchor.json') };
  fs.writeFileSync(files.index, JSON.stringify(makeIndex('0.6.43-dev'))); fs.writeFileSync(files.other, JSON.stringify(makeIndex('0.6.44-dev'))); fs.writeFileSync(files.history, JSON.stringify(history)); fs.writeFileSync(files.snapshot, JSON.stringify(snapshot));
  assert.equal(run('scripts/create-reviewer-trust-policy-anchor.js',['--external-review-index',files.index,'--trust-history',files.history,'--trust-history-snapshot',files.snapshot,'--anchored-by','test-registry','--anchored-at','2026-10-03T06:01:00Z','--output',files.anchor]).status,0);
  const rejected = run('scripts/verify-reviewer-trust-policy-anchor.js',['--anchor',files.anchor,'--external-review-index',files.other,'--trust-history',files.history,'--trust-history-snapshot',files.snapshot]);
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stdout).ok, false);
});

