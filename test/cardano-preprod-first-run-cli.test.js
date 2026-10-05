import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createCheckpointManifest, createSourceTreeInventory } from '../src/core/checkpoint-manifest.js';
import { verifyPackageLockIntegrity } from '../src/core/dependency-integrity.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = args => spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });

function makeBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-first-run-bundle-'));
  const pkgText = fs.readFileSync('package.json', 'utf8');
  const lockText = fs.readFileSync('package-lock.json', 'utf8');
  const pkg = JSON.parse(pkgText);
  const base = `omegavault-mvp-${pkg.version}`;
  const archive = path.join(dir, `${base}.zip`);
  const manifestPath = path.join(dir, `${base}.checkpoint-manifest.json`);
  const indexPath = path.join(dir, `${base}.review-index.json`);
  fs.writeFileSync(archive, 'cardano-first-run-fixture-archive');

  const lock = verifyPackageLockIntegrity({ packageJsonText: pkgText, packageLockText: lockText });
  const inventory = createSourceTreeInventory(process.cwd());
  const manifest = createCheckpointManifest({
    checkpoint: { ref: pkg.version, archive: path.basename(archive), archiveSha256: sha(fs.readFileSync(archive)) },
    dependencyLock: lock.binding,
    sourceInventory: inventory
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, sourceInventory: inventory }, null, 2)}\n`);

  const generated = run(['scripts/generate-external-review-index.js', '--archive', archive, '--checkpoint-manifest', manifestPath, '--output', indexPath]);
  assert.equal(generated.status, 0, generated.stderr);
  return { dir };
}

test('Cardano first run performs strict launch then emits a no-signing operator handoff', () => {
  const bundle = makeBundle();
  const campaign = path.join(os.tmpdir(), `omegavault-cardano-first-run-${process.pid}-${Date.now()}`);
  const result = run([
    'scripts/cardano-preprod-first-run.js',
    '--bundle-dir', bundle.dir,
    '--campaign', campaign
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.checkpointRef, '0.6.59-dev');
  assert.deepEqual(report.actions, ['initialize', 'heartbeat', 'approve', 'execute']);
  assert.equal(report.handoff.campaign.structurallyReady, true);
  assert.equal(report.handoff.campaign.incomplete.length, 4);
  assert.equal(report.walletSigningAuthorized, false);
  assert.equal(report.transactionSubmissionAuthorized, false);
  assert.equal(report.supportClaimAuthorized, false);
  assert.equal(report.networkRequestsPerformed, false);
  assert.match(report.hardStop, /Do not sign or submit/);

  const rerun = run([
    'scripts/cardano-preprod-first-run.js',
    '--bundle-dir', bundle.dir,
    '--campaign', campaign
  ]);
  assert.equal(rerun.status, 2);
  assert.match(rerun.stderr, /already exists|Refusing to overwrite/i);

  fs.rmSync(campaign, { recursive: true, force: true });
  fs.rmSync(bundle.dir, { recursive: true, force: true });
});
