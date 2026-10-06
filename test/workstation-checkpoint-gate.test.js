import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCheckpointManifest, createSourceTreeInventory } from '../src/core/checkpoint-manifest.js';
import { verifyPackageLockIntegrity } from '../src/core/dependency-integrity.js';
import { verifyWorkstationCheckpointSource } from '../src/core/workstation-checkpoint-gate.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('workstation checkpoint source gate binds archive, dependency lock and extracted source tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-workstation-source-'));
  const archive = path.join(root, 'outside-source.zip');
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const packageJson = fs.readFileSync('package.json', 'utf8');
  const packageLock = fs.readFileSync('package-lock.json', 'utf8');
  fs.writeFileSync(path.join(source, 'package.json'), packageJson);
  fs.writeFileSync(path.join(source, 'package-lock.json'), packageLock);
  fs.writeFileSync(path.join(source, 'marker.txt'), 'sealed-source');
  fs.writeFileSync(archive, 'archive-bytes');

  const lock = verifyPackageLockIntegrity({ packageJsonText: packageJson, packageLockText: packageLock });
  assert.equal(lock.ok, true);
  const inventory = createSourceTreeInventory(source);
  const pkg = JSON.parse(packageJson);
  const manifestCore = createCheckpointManifest({
    checkpoint: { ref: pkg.version, archive: path.basename(archive), archiveSha256: sha(fs.readFileSync(archive)) },
    dependencyLock: lock.binding,
    sourceInventory: inventory
  });
  const manifest = { ...manifestCore, sourceInventory: inventory };

  const valid = verifyWorkstationCheckpointSource({ projectRoot: source, checkpointManifest: manifest, sourceArchivePath: archive });
  assert.equal(valid.ok, true, valid.errors.join('; '));

  fs.writeFileSync(path.join(source, 'marker.txt'), 'drifted-source');
  const drifted = verifyWorkstationCheckpointSource({ projectRoot: source, checkpointManifest: manifest, sourceArchivePath: archive });
  assert.equal(drifted.ok, false);
  assert.ok(drifted.errors.some(error => /does not match sealed bytes: marker\.txt/.test(error)));
});

test('workstation checkpoint source gate accepts byte-identical source when aggregate ordering digests differ by platform', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-workstation-cross-platform-'));
  const archive = path.join(root, 'outside-source.zip');
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const packageJson = fs.readFileSync('package.json', 'utf8');
  const packageLock = fs.readFileSync('package-lock.json', 'utf8');
  fs.writeFileSync(path.join(source, 'package.json'), packageJson);
  fs.writeFileSync(path.join(source, 'package-lock.json'), packageLock);
  fs.writeFileSync(path.join(source, 'Alpha.txt'), 'A');
  fs.writeFileSync(path.join(source, 'beta.txt'), 'B');
  fs.writeFileSync(archive, 'archive-bytes');

  const lock = verifyPackageLockIntegrity({ packageJsonText: packageJson, packageLockText: packageLock });
  assert.equal(lock.ok, true);
  const inventory = createSourceTreeInventory(source);
  const sealedInventory = {
    ...inventory,
    files: [...inventory.files].reverse(),
    sha256: '11'.repeat(32)
  };
  const sealedDependency = {
    ...lock.binding,
    sha256: '22'.repeat(32)
  };
  const pkg = JSON.parse(packageJson);
  const manifest = createCheckpointManifest({
    checkpoint: { ref: pkg.version, archive: path.basename(archive), archiveSha256: sha(fs.readFileSync(archive)) },
    dependencyLock: sealedDependency,
    sourceInventory: sealedInventory
  });
  const manifestWithInventory = { ...manifest, sourceInventory: sealedInventory };

  const valid = verifyWorkstationCheckpointSource({
    projectRoot: source,
    checkpointManifest: manifestWithInventory,
    sourceArchivePath: archive
  });
  assert.equal(valid.ok, true, valid.errors.join('; '));
  assert.equal(valid.sourceFileBytesVerified, true);
  assert.equal(valid.dependencyFileBytesVerified, true);
  assert.equal(valid.sourceTreeSha256, sealedInventory.sha256);
  assert.equal(valid.dependencyLockSha256, sealedDependency.sha256);
  assert.notEqual(valid.runtimeSourceTreeSha256, sealedInventory.sha256);
  assert.notEqual(valid.runtimeDependencyLockSha256, sealedDependency.sha256);
});

test('workstation checkpoint source gate rejects swapped source archive bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-workstation-archive-'));
  const source = path.join(root, 'source');
  const archive = path.join(root, 'source.zip');
  fs.mkdirSync(source);
  const packageJson = fs.readFileSync('package.json', 'utf8');
  const packageLock = fs.readFileSync('package-lock.json', 'utf8');
  fs.writeFileSync(path.join(source, 'package.json'), packageJson);
  fs.writeFileSync(path.join(source, 'package-lock.json'), packageLock);
  fs.writeFileSync(archive, 'expected');

  const lock = verifyPackageLockIntegrity({ packageJsonText: packageJson, packageLockText: packageLock });
  const inventory = createSourceTreeInventory(source);
  const pkg = JSON.parse(packageJson);
  const manifestCore = createCheckpointManifest({
    checkpoint: { ref: pkg.version, archive: path.basename(archive), archiveSha256: sha(fs.readFileSync(archive)) },
    dependencyLock: lock.binding,
    sourceInventory: inventory
  });
  const manifest = { ...manifestCore, sourceInventory: inventory };
  fs.writeFileSync(archive, 'swapped');

  const result = verifyWorkstationCheckpointSource({ projectRoot: source, checkpointManifest: manifest, sourceArchivePath: archive });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /archive SHA-256/.test(error)));
});
