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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-launch-bundle-'));
  const pkgText = fs.readFileSync('package.json', 'utf8');
  const lockText = fs.readFileSync('package-lock.json', 'utf8');
  const pkg = JSON.parse(pkgText);
  const base = `omegavault-mvp-${pkg.version}`;
  const archive = path.join(dir, `${base}.zip`);
  const manifestPath = path.join(dir, `${base}.checkpoint-manifest.json`);
  const indexPath = path.join(dir, `${base}.review-index.json`);
  fs.writeFileSync(archive, 'workstation-launch-fixture-archive');

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
  return { dir, archive, manifestPath, indexPath };
}

test('Cardano workstation launch gate verifies sealed bundle/source/dependencies before preparing an external session', () => {
  const bundle = makeBundle();
  const session = path.join(os.tmpdir(), `omegavault-cardano-launch-${process.pid}-${Date.now()}`);
  const launched = run(['scripts/cardano-preprod-workstation-launch.js', '--bundle-dir', bundle.dir, '--session', session, '--action', 'execute']);
  assert.equal(launched.status, 0, launched.stderr);
  const result = JSON.parse(launched.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.externalReviewVerified, true);
  assert.equal(result.pinnedDependenciesReady, true);
  assert.equal(result.networkRequestsPerformed, false);
  assert.equal(result.walletSigningAuthorized, false);
  assert.equal(result.transactionSubmissionAuthorized, false);
  assert.equal(fs.existsSync(path.join(session, 'capture-manifest.json')), true);
  assert.equal(path.resolve(session).startsWith(path.resolve(process.cwd()) + path.sep), false);
});

test('Cardano workstation launch gate fails closed if the sealed source archive is swapped', () => {
  const bundle = makeBundle();
  fs.writeFileSync(bundle.archive, 'swapped-after-review');
  const session = path.join(os.tmpdir(), `omegavault-cardano-launch-reject-${process.pid}-${Date.now()}`);
  const launched = run(['scripts/cardano-preprod-workstation-launch.js', '--bundle-dir', bundle.dir, '--session', session]);
  assert.equal(launched.status, 2);
  assert.match(launched.stderr, /archive SHA-256|review-index/i);
  assert.equal(fs.existsSync(path.join(session, 'capture-manifest.json')), false);
});
