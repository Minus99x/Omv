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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-evaluation-gate-bundle-'));
  const sealedSource = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-evaluation-sealed-source-'));
  fs.copyFileSync('package.json', path.join(sealedSource, 'package.json'));
  fs.copyFileSync('package-lock.json', path.join(sealedSource, 'package-lock.json'));

  const pkgText = fs.readFileSync(path.join(sealedSource, 'package.json'), 'utf8');
  const lockText = fs.readFileSync(path.join(sealedSource, 'package-lock.json'), 'utf8');
  const pkg = JSON.parse(pkgText);
  const base = `omegavault-mvp-${pkg.version}`;
  const archive = path.join(dir, `${base}.zip`);
  const manifestPath = path.join(dir, `${base}.checkpoint-manifest.json`);
  const indexPath = path.join(dir, `${base}.review-index.json`);
  fs.writeFileSync(archive, 'evaluation-workstation-gate-fixture');

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

test('Cardano evaluation workstation gate verifies a separate sealed source and stops before network/campaign work', () => {
  const bundle = makeBundle();
  const campaign = path.join(os.tmpdir(), `omegavault-live-campaign-${process.pid}`);
  const gated = run([
    'scripts/cardano-preprod-evaluation-workstation-gate.js',
    '--bundle-dir', bundle.dir,
    '--sealed-source', bundle.sealedSource,
    '--campaign', campaign
  ]);
  assert.equal(gated.status, 0, gated.stderr);
  const report = JSON.parse(gated.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.externalReviewVerified, true);
  assert.equal(report.pinnedDependenciesReady, true);
  assert.equal(report.sealedSourceRoot, path.resolve(bundle.sealedSource));
  assert.equal(report.sealedSourceTreeSha256, bundle.inventory.sha256);
  assert.equal(report.toolingRoot, path.resolve(process.cwd()));
  assert.match(report.toolingSourceTreeSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.networkRequestsPerformed, false);
  assert.equal(report.walletSigningAuthorized, false);
  assert.equal(report.transactionSubmissionAuthorized, false);
  assert.equal(report.supportClaimAuthorized, false);
  assert.deepEqual(report.requiredEnvironment, ['OMEGAVAULT_OGMIOS_URL', 'BLOCKFROST_PROJECT_ID']);
  assert.match(report.nextCommand, /cardano:preprod:campaign:capture/);
  assert.equal(fs.existsSync(path.join(campaign, 'campaign-manifest.json')), false);
  fs.rmSync(bundle.dir, { recursive: true, force: true });
  fs.rmSync(bundle.sealedSource, { recursive: true, force: true });
});

test('Cardano evaluation workstation gate fails closed if the separate sealed source is altered', () => {
  const bundle = makeBundle();
  fs.writeFileSync(path.join(bundle.sealedSource, 'unexpected-file.txt'), 'tamper');
  const gated = run([
    'scripts/cardano-preprod-evaluation-workstation-gate.js',
    '--bundle-dir', bundle.dir,
    '--sealed-source', bundle.sealedSource
  ]);
  assert.equal(gated.status, 2);
  assert.match(gated.stderr, /Checkpoint source gate failed/i);
  fs.rmSync(bundle.dir, { recursive: true, force: true });
  fs.rmSync(bundle.sealedSource, { recursive: true, force: true });
});
