import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createSourceTreeInventory, verifyCheckpointManifest } from './checkpoint-manifest.js';
import { verifyPackageLockIntegrity } from './dependency-integrity.js';

const SHA256 = /^[0-9a-f]{64}$/i;

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function compareInventoryFiles(expectedInventory, actualInventory) {
  const errors = [];
  const expectedFiles = expectedInventory?.files;
  const actualFiles = actualInventory?.files;

  if (!Array.isArray(expectedFiles)) return ['Checkpoint manifest is missing its full source inventory.'];
  if (!Array.isArray(actualFiles)) return ['Extracted source inventory is unavailable.'];

  const expected = new Map();
  for (const file of expectedFiles) {
    if (!file?.path || expected.has(file.path)) {
      errors.push('Checkpoint source inventory contains an invalid or duplicate path.');
      continue;
    }
    expected.set(file.path, file);
  }

  const actual = new Map();
  for (const file of actualFiles) {
    if (!file?.path || actual.has(file.path)) {
      errors.push('Extracted source inventory contains an invalid or duplicate path.');
      continue;
    }
    actual.set(file.path, file);
  }

  for (const [path, sealed] of expected) {
    const current = actual.get(path);
    if (!current) {
      errors.push(`Extracted source is missing sealed file ${path}.`);
      continue;
    }
    if (Number(current.sizeBytes) !== Number(sealed.sizeBytes) || current.sha256 !== sealed.sha256) {
      errors.push(`Extracted source file does not match sealed bytes: ${path}.`);
    }
  }

  for (const path of actual.keys()) {
    if (!expected.has(path)) errors.push(`Extracted source contains an unexpected file: ${path}.`);
  }

  return errors;
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

  const sealedDependency = checkpointManifest?.dependencyLock ?? null;
  const packageJsonSha256 = sha256Text(packageJsonText);
  const packageLockSha256 = sha256Text(packageLockText);
  let dependencyBytesMatch = false;
  if (!sealedDependency) {
    errors.push('Checkpoint manifest is missing the sealed dependency-lock binding.');
  } else {
    if (packageJsonSha256 !== sealedDependency.packageJsonSha256) {
      errors.push('package.json SHA-256 does not match the sealed checkpoint.');
    }
    if (packageLockSha256 !== sealedDependency.packageLockSha256) {
      errors.push('package-lock.json SHA-256 does not match the sealed checkpoint.');
    }
    if (Number(lock?.binding?.lockfileVersion) !== Number(sealedDependency.lockfileVersion)) {
      errors.push('Dependency lockfile version does not match the sealed checkpoint.');
    }
    if ((lock?.binding?.nodeEngine ?? null) !== (sealedDependency.nodeEngine ?? null)) {
      errors.push('Node engine binding does not match the sealed checkpoint.');
    }
    dependencyBytesMatch =
      packageJsonSha256 === sealedDependency.packageJsonSha256 &&
      packageLockSha256 === sealedDependency.packageLockSha256 &&
      Number(lock?.binding?.lockfileVersion) === Number(sealedDependency.lockfileVersion) &&
      (lock?.binding?.nodeEngine ?? null) === (sealedDependency.nodeEngine ?? null);
  }

  const inventoryErrors = compareInventoryFiles(checkpointManifest?.sourceInventory, sourceInventory);
  errors.push(...inventoryErrors);
  const sourceBytesMatch = inventoryErrors.length === 0;

  // The sealed checkpoint was created on Linux while workstation verification may run
  // on Windows. JavaScript localeCompare() can order otherwise-identical path/package
  // sets differently across locales, which changes aggregate digests without changing
  // a single source byte. Verify actual bytes above, then validate the manifest's own
  // sealed aggregate identities rather than substituting locale-dependent runtime order.
  if (dependencyBytesMatch && sourceBytesMatch && checkpointManifest?.checkpoint) {
    const verification = verifyCheckpointManifest(checkpointManifest, {
      checkpoint: checkpointManifest.checkpoint,
      dependencyLock: checkpointManifest.dependencyLock,
      sourceInventory: checkpointManifest.sourceInventory,
      proofBundleSha256: checkpointManifest.proofBundleSha256 ?? null
    });
    errors.push(...verification.errors);
  }

  return Object.freeze({
    schema: 'omegavault.workstation-checkpoint-source-gate.v2',
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    checkpointRef: checkpointManifest?.checkpoint?.ref ?? null,
    packageVersion: pkg.version,
    archiveSha256: checkpointManifest?.checkpoint?.archiveSha256 ?? null,
    sourceTreeSha256: sourceBytesMatch ? (checkpointManifest?.sourceTree?.sha256 ?? null) : (sourceInventory?.sha256 ?? null),
    dependencyLockSha256: dependencyBytesMatch ? (checkpointManifest?.dependencyLock?.sha256 ?? null) : (lock?.binding?.sha256 ?? null),
    sourceFileBytesVerified: sourceBytesMatch,
    dependencyFileBytesVerified: dependencyBytesMatch,
    runtimeSourceTreeSha256: sourceInventory?.sha256 ?? null,
    runtimeDependencyLockSha256: lock?.binding?.sha256 ?? null
  });
}
