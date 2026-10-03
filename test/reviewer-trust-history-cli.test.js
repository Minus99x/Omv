import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { verifyReviewerTrustHistory } from '../src/core/reviewer-trust-history.js';

function run(args) {
  return spawnSync(process.execPath, ['scripts/append-reviewer-trust-event.js', ...args], { cwd:process.cwd(), encoding:'utf8' });
}

test('trust-history CLI enrolls, rotates and revokes using public keys only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-trust-history-cli-'));
  const first = generateKeyPairSync('ed25519');
  const second = generateKeyPairSync('ed25519');
  const firstKey = path.join(dir, 'first-public.pem');
  const secondKey = path.join(dir, 'second-public.pem');
  const enrolled = path.join(dir, 'enrolled.json');
  const rotated = path.join(dir, 'rotated.json');
  const revoked = path.join(dir, 'revoked.json');
  const snapshot = path.join(dir, 'revoked.snapshot.json');
  fs.writeFileSync(firstKey, first.publicKey.export({type:'spki',format:'pem'}));
  fs.writeFileSync(secondKey, second.publicKey.export({type:'spki',format:'pem'}));

  const enroll = run(['--reviewer','audit-team','--public-key',firstKey,'--action','enroll','--configured-by','test-policy','--configured-at','2026-10-03T05:00:00Z','--output',enrolled]);
  assert.equal(enroll.status, 0, enroll.stderr);
  assert.equal(JSON.parse(enroll.stdout).eventCount, 1);
  const rotate = run(['--reviewer','audit-team','--public-key',secondKey,'--action','rotate','--configured-by','test-policy','--configured-at','2026-10-03T05:01:00Z','--history',enrolled,'--output',rotated]);
  assert.equal(rotate.status, 0, rotate.stderr);
  assert.equal(JSON.parse(rotate.stdout).status, 'trusted');
  const revoke = run(['--reviewer','audit-team','--public-key',secondKey,'--action','revoke','--configured-by','test-policy','--configured-at','2026-10-03T05:02:00Z','--reason','review engagement ended','--history',rotated,'--output',revoked,'--snapshot-output',snapshot]);
  assert.equal(revoke.status, 0, revoke.stderr);
  const history = JSON.parse(fs.readFileSync(revoked,'utf8'));
  assert.equal(history.length, 3);
  assert.equal(verifyReviewerTrustHistory(history).status, 'revoked');
  assert.equal(JSON.parse(revoke.stdout).promotionAuthority, false);
  assert.equal(JSON.parse(fs.readFileSync(snapshot,'utf8')).eventCount, 3);
});

test('trust-history CLI refuses private-key-free invalid lineage and output overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-trust-history-reject-'));
  const key = generateKeyPairSync('ed25519');
  const publicKey = path.join(dir, 'public.pem');
  const historyPath = path.join(dir, 'history.json');
  fs.writeFileSync(publicKey, key.publicKey.export({type:'spki',format:'pem'}));
  const missingHistory = run(['--reviewer','audit-team','--public-key',publicKey,'--action','rotate','--configured-by','test-policy','--configured-at','2026-10-03T05:00:00Z','--output',historyPath]);
  assert.equal(missingHistory.status, 2);
  const enroll = run(['--reviewer','audit-team','--public-key',publicKey,'--action','enroll','--configured-by','test-policy','--configured-at','2026-10-03T05:00:00Z','--output',historyPath]);
  assert.equal(enroll.status, 0, enroll.stderr);
  const overwrite = run(['--reviewer','audit-team','--public-key',publicKey,'--action','enroll','--configured-by','test-policy','--configured-at','2026-10-03T05:00:00Z','--output',historyPath]);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /already exists/i);
});

test('reviewer trust append preflights outputs and rejects secret-bearing arguments', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-reviewer-trust-preflight-'));
  const key=generateKeyPairSync('ed25519');
  const publicKey=path.join(dir,'public.pem');
  fs.writeFileSync(publicKey,key.publicKey.export({type:'spki',format:'pem'}));

  const historyOutput=path.join(dir,'history.json');
  const existingSnapshot=path.join(dir,'existing-snapshot.json');
  fs.writeFileSync(existingSnapshot,'already here');

  const collision=run([
    '--reviewer','audit-team','--public-key',publicKey,'--action','enroll',
    '--configured-by','test-policy','--configured-at','2026-10-03T23:20:00Z',
    '--output',historyOutput,'--snapshot-output',existingSnapshot
  ]);
  assert.equal(collision.status,1);
  assert.match(collision.stderr,/snapshot output already exists/i);
  assert.equal(fs.existsSync(historyOutput),false);

  const samePath=path.join(dir,'same.json');
  const same=run([
    '--reviewer','audit-team','--public-key',publicKey,'--action','enroll',
    '--configured-by','test-policy','--configured-at','2026-10-03T23:21:00Z',
    '--output',samePath,'--snapshot-output',samePath
  ]);
  assert.equal(same.status,1);
  assert.match(same.stderr,/different paths/i);
  assert.equal(fs.existsSync(samePath),false);

  for (const forbidden of ['private-key','secret-key','seed','key-output']) {
    const result=run([
      '--reviewer','audit-team','--public-key',publicKey,'--action','enroll',
      '--configured-by','test-policy','--configured-at','2026-10-03T23:22:00Z',
      '--output',path.join(dir,`forbidden-${forbidden}.json`),
      `--${forbidden}`,'secret'
    ]);
    assert.equal(result.status,2);
    assert.match(result.stderr,/secret input is forbidden/i);
  }
});
