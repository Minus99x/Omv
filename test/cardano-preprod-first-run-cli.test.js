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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-first-run-v3-bundle-'));
  const sealedSource = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-first-run-v3-sealed-source-'));
  fs.copyFileSync('package.json', path.join(sealedSource, 'package.json'));
  fs.copyFileSync('package-lock.json', path.join(sealedSource, 'package-lock.json'));

  const pkgText = fs.readFileSync(path.join(sealedSource, 'package.json'), 'utf8');
  const lockText = fs.readFileSync(path.join(sealedSource, 'package-lock.json'), 'utf8');
  const pkg = JSON.parse(pkgText);
  const base = `omegavault-mvp-${pkg.version}`;
  const archive = path.join(dir, `${base}.zip`);
  const manifestPath = path.join(dir, `${base}.checkpoint-manifest.json`);
  const indexPath = path.join(dir, `${base}.review-index.json`);
  fs.writeFileSync(archive, 'first-run-v3-fixture');
  const lock = verifyPackageLockIntegrity({ packageJsonText: pkgText, packageLockText: lockText });
  const inventory = createSourceTreeInventory(sealedSource);
  const manifest = createCheckpointManifest({
    checkpoint: { ref: pkg.version, archive: path.basename(archive), archiveSha256: sha(fs.readFileSync(archive)) },
    dependencyLock: lock.binding,
    sourceInventory: inventory
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, sourceInventory: inventory }, null, 2)}\n`);
  const generated = run(['scripts/generate-external-review-index.js', '--archive', archive, '--checkpoint-manifest', manifestPath, '--output', indexPath]);
  assert.equal(generated.status, 0, generated.stderr);
  return { dir, sealedSource, inventory };
}

test('Cardano first run verifies a separate sealed package without creating a stale offline campaign', () => {
  const bundle = makeBundle();
  const campaign = path.join(os.tmpdir(), `omegavault-first-run-v3-campaign-${process.pid}`);
  const result = run([
    'scripts/cardano-preprod-first-run.js',
    '--bundle-dir', bundle.dir,
    '--sealed-source', bundle.sealedSource,
    '--campaign', campaign
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.externalReviewVerified, true);
  assert.equal(report.sealedSourceRoot, path.resolve(bundle.sealedSource));
  assert.equal(report.sealedSourceTreeSha256, bundle.inventory.sha256);
  assert.match(report.toolingSourceTreeSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.networkRequestsPerformed, false);
  assert.equal(report.walletSigningAuthorized, false);
  assert.equal(report.transactionSubmissionAuthorized, false);
  assert.equal(report.supportClaimAuthorized, false);
  assert.match(report.nextCommand, /cardano:preprod:campaign:capture/);
  assert.equal(fs.existsSync(path.join(campaign, 'campaign-manifest.json')), false);
  fs.rmSync(bundle.dir, { recursive: true, force: true });
  fs.rmSync(bundle.sealedSource, { recursive: true, force: true });
});
