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
  const manifest = createCheckpointManifest({
    checkpoint: { ref: pkg.version, archive: path.basename(archive), archiveSha256: sha(fs.readFileSync(archive)) },
    dependencyLock: lock.binding,
    sourceInventory: inventory
  });

  const valid = verifyWorkstationCheckpointSource({ projectRoot: source, checkpointManifest: manifest, sourceArchivePath: archive });
  assert.equal(valid.ok, true, valid.errors.join('; '));

  fs.writeFileSync(path.join(source, 'marker.txt'), 'drifted-source');
  const drifted = verifyWorkstationCheckpointSource({ projectRoot: source, checkpointManifest: manifest, sourceArchivePath: archive });
  assert.equal(drifted.ok, false);
  assert.ok(drifted.errors.some(error => /Source-tree binding mismatch/.test(error)));
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
  const manifest = createCheckpointManifest({
    checkpoint: { ref: pkg.version, archive: path.basename(archive), archiveSha256: sha(fs.readFileSync(archive)) },
    dependencyLock: lock.binding,
    sourceInventory: inventory
  });
  fs.writeFileSync(archive, 'swapped');

  const result = verifyWorkstationCheckpointSource({ projectRoot: source, checkpointManifest: manifest, sourceArchivePath: archive });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /archive SHA-256/.test(error)));
});
