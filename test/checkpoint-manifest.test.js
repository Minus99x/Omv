import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointManifest, createSourceTreeInventory, verifyCheckpointManifest } from '../src/core/checkpoint-manifest.js';

const dependencyLock = Object.freeze({
  schema: 'omegavault.dependency-lock.v1',
  sha256: '11'.repeat(32),
  packageJsonSha256: '22'.repeat(32),
  packageLockSha256: '33'.repeat(32),
  lockfileVersion: 3,
  nodeEngine: '>=22.12'
});
const checkpoint = Object.freeze({ ref: '0.6.31-dev', archive: 'omegavault-mvp-0.6.31-dev.zip', archiveSha256: '44'.repeat(32) });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'omegavault-manifest-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'README.md'), 'OmegaVault\n');
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src', 'b.js'), 'export const b = 2;\n');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'ignored.txt'), 'ignored');
  return root;
}

test('source-tree inventory is deterministic and excludes non-checkpoint working directories', () => {
  const root = fixture();
  const first = createSourceTreeInventory(root);
  const second = createSourceTreeInventory(root);
  assert.deepEqual(first, second);
  assert.equal(first.fileCount, 3);
  assert.deepEqual(first.files.map(file => file.path), ['README.md', 'src/a.js', 'src/b.js']);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
});

test('source-tree inventory digest changes when source bytes change', () => {
  const root = fixture();
  const before = createSourceTreeInventory(root);
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 9;\n');
  const after = createSourceTreeInventory(root);
  assert.notEqual(before.sha256, after.sha256);
});

test('checkpoint manifest binds archive, dependency lock and source tree', () => {
  const inventory = createSourceTreeInventory(fixture());
  const manifest = createCheckpointManifest({ checkpoint, dependencyLock, sourceInventory: inventory, proofBundleSha256: '55'.repeat(32) });
  assert.equal(manifest.checkpoint.archiveSha256, checkpoint.archiveSha256);
  assert.equal(manifest.dependencyLock.sha256, dependencyLock.sha256);
  assert.equal(manifest.sourceTree.sha256, inventory.sha256);
  assert.equal(manifest.proofBundleSha256, '55'.repeat(32));
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyCheckpointManifest(manifest, { checkpoint, dependencyLock, sourceInventory: inventory, proofBundleSha256: '55'.repeat(32) }), { ok: true, errors: [] });
});

test('checkpoint manifest fails verification if archive identity changes', () => {
  const inventory = createSourceTreeInventory(fixture());
  const manifest = createCheckpointManifest({ checkpoint, dependencyLock, sourceInventory: inventory });
  const result = verifyCheckpointManifest(manifest, { checkpoint: { ...checkpoint, archiveSha256: '66'.repeat(32) }, dependencyLock, sourceInventory: inventory });
  assert.equal(result.ok, false);
});

test('checkpoint manifest fails verification if source tree changes', () => {
  const root = fixture();
  const inventory = createSourceTreeInventory(root);
  const manifest = createCheckpointManifest({ checkpoint, dependencyLock, sourceInventory: inventory });
  writeFileSync(join(root, 'src', 'b.js'), 'export const b = 99;\n');
  const changed = createSourceTreeInventory(root);
  const result = verifyCheckpointManifest(manifest, { checkpoint, dependencyLock, sourceInventory: changed });
  assert.equal(result.ok, false);
});

test('source-tree inventory rejects unsafe exclude paths', () => {
  assert.throws(() => createSourceTreeInventory(fixture(), { excludes: ['../outside'] }), /safe relative path/);
});
