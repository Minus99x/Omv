import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSourceTreeInventory, createCheckpointManifest } from '../src/core/checkpoint-manifest.js';
import { verifyPackageLockIntegrity } from '../src/core/dependency-integrity.js';

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

test('review-index CLI generates and verifies an externally bound review package', () => {
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-review-index-'));
  const archivePath = path.join(dir, 'omegavault-mvp-0.6.40-dev.zip');
  const archiveBytes = Buffer.from('deterministic-fixture-archive');
  fs.writeFileSync(archivePath, archiveBytes);

  const packageJsonText = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const packageLockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const dependency = verifyPackageLockIntegrity({ packageJsonText, packageLockText });
  assert.equal(dependency.ok, true);
  const sourceInventory = createSourceTreeInventory(root);
  const manifest = createCheckpointManifest({
    checkpoint: { ref: '0.6.40-dev', archive: path.basename(archivePath), archiveSha256: sha256(archiveBytes) },
    dependencyLock: dependency.binding,
    sourceInventory
  });
  const sidecar = { ...manifest, sourceInventory };
  const manifestPath = path.join(dir, 'omegavault-mvp-0.6.40-dev.checkpoint-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  const indexPath = path.join(dir, 'omegavault-mvp-0.6.40-dev.review-index.json');

  const generated = spawnSync(process.execPath, ['scripts/generate-external-review-index.js', '--archive', archivePath, '--checkpoint-manifest', manifestPath, '--output', indexPath], { cwd: root, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  assert.equal(index.schema, 'omegavault.external-review-index.v1');
  assert.equal(index.checkpoint.archiveSha256, sha256(archiveBytes));

  const verified = spawnSync(process.execPath, ['scripts/verify-external-review-index.js', '--index', indexPath, '--archive', archivePath, '--checkpoint-manifest', manifestPath], { cwd: root, encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);

  fs.writeFileSync(archivePath, Buffer.from('swapped-archive'));
  const swapped = spawnSync(process.execPath, ['scripts/verify-external-review-index.js', '--index', indexPath, '--archive', archivePath, '--checkpoint-manifest', manifestPath], { cwd: root, encoding: 'utf8' });
  assert.equal(swapped.status, 2);
  assert.match(swapped.stderr, /Archive does not match checkpoint manifest/);
});
