import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createSourceTreeInventory, verifyCheckpointManifest } from './checkpoint-manifest.js';
import { verifyPackageLockIntegrity } from './dependency-integrity.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function verifyWorkstationCheckpointSource({
  projectRoot,
  checkpointManifest,
  sourceArchivePath
}) {
  const errors = [];
  const root = resolve(projectRoot);
  let packageJsonText;
  let packageLockText;
  let lock;
  let sourceInventory;

  try {
    packageJsonText = readFileSync(join(root, 'package.json'), 'utf8');
    packageLockText = readFileSync(join(root, 'package-lock.json'), 'utf8');
    lock = verifyPackageLockIntegrity({ packageJsonText, packageLockText });
    if (!lock.ok) errors.push(...lock.errors.map(value => `Dependency lock: ${value}`));
    sourceInventory = createSourceTreeInventory(root);
  } catch (error) {
    return Object.freeze({ ok: false, errors: Object.freeze([error.message]) });
  }

  const pkg = JSON.parse(packageJsonText);
  if (checkpointManifest?.schema !== 'omegavault.checkpoint-manifest.v1') errors.push('Checkpoint manifest schema is invalid.');
  if (checkpointManifest?.checkpoint?.ref !== pkg.version) {
    errors.push(`Checkpoint ref ${checkpointManifest?.checkpoint?.ref ?? 'missing'} does not match package version ${pkg.version}.`);
  }

  if (!sourceArchivePath) {
    errors.push('Source archive path is required for workstation checkpoint verification.');
  } else {
    const archiveName = basename(sourceArchivePath);
    if (archiveName !== checkpointManifest?.checkpoint?.archive) errors.push('Source archive filename does not match checkpoint manifest.');
    const expected = checkpointManifest?.checkpoint?.archiveSha256;
    if (!SHA256.test(String(expected ?? ''))) {
      errors.push('Checkpoint archive SHA-256 is invalid.');
    } else {
      try {
        const actual = sha256File(sourceArchivePath);
        if (actual !== expected) errors.push('Source archive SHA-256 does not match checkpoint manifest.');
      } catch (error) {
        errors.push(`Source archive could not be read: ${error.message}`);
      }
    }
  }

  if (lock?.ok && sourceInventory && checkpointManifest?.checkpoint) {
    const verification = verifyCheckpointManifest(checkpointManifest, {
      checkpoint: checkpointManifest.checkpoint,
      dependencyLock: lock.binding,
      sourceInventory,
      proofBundleSha256: checkpointManifest.proofBundleSha256 ?? null
    });
    errors.push(...verification.errors);
  }

  return Object.freeze({
    schema: 'omegavault.workstation-checkpoint-source-gate.v1',
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    checkpointRef: checkpointManifest?.checkpoint?.ref ?? null,
    packageVersion: pkg.version,
    archiveSha256: checkpointManifest?.checkpoint?.archiveSha256 ?? null,
    sourceTreeSha256: sourceInventory?.sha256 ?? null,
    dependencyLockSha256: lock?.binding?.sha256 ?? null
  });
}
