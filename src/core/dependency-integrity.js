import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch (error) { throw new TypeError(`${label} is not valid JSON: ${error.message}`); }
}

function packageEntry(lockfile, name) {
  return lockfile?.packages?.[`node_modules/${name}`] ?? null;
}

function collectPins(pkg) {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
}

export function verifyPackageLockIntegrity({ packageJsonText, packageLockText }) {
  const pkg = parseJson(packageJsonText, 'package.json');
  const lock = parseJson(packageLockText, 'package-lock.json');
  const errors = [];
  const warnings = [];
  const pins = collectPins(pkg);
  const root = lock?.packages?.[''] ?? {};

  if (lock?.lockfileVersion !== 3) errors.push(`Expected npm lockfileVersion 3, found ${lock?.lockfileVersion ?? 'missing'}.`);
  if (lock?.name !== pkg?.name || root?.name !== pkg?.name) errors.push('package.json and package-lock project names do not match.');
  if (lock?.version !== pkg?.version || root?.version !== pkg?.version) errors.push('package.json and package-lock project versions do not match.');

  for (const [name, version] of Object.entries(pins).sort(([a], [b]) => a.localeCompare(b))) {
    if (!EXACT_VERSION.test(String(version))) errors.push(`${name} is not pinned to an exact semver version.`);
    const rootVersion = pkg?.dependencies?.[name] != null ? root?.dependencies?.[name] : root?.devDependencies?.[name];
    if (rootVersion !== version) errors.push(`${name} root lock pin does not match package.json (${version} vs ${rootVersion ?? 'missing'}).`);
    const entry = packageEntry(lock, name);
    if (!entry) {
      errors.push(`${name} is missing from package-lock packages.`);
      continue;
    }
    if (entry.version !== version) errors.push(`${name} resolved version ${entry.version ?? 'missing'} does not equal exact pin ${version}.`);
    if (typeof entry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/=]+$/.test(entry.integrity)) {
      errors.push(`${name} is missing a valid sha512 integrity value.`);
    }
  }

  for (const name of Object.keys(root?.dependencies ?? {})) if (pkg?.dependencies?.[name] == null) warnings.push(`Lockfile root has undeclared dependency ${name}.`);
  for (const name of Object.keys(root?.devDependencies ?? {})) if (pkg?.devDependencies?.[name] == null) warnings.push(`Lockfile root has undeclared devDependency ${name}.`);

  const manifest = Object.freeze(Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b)).map(([name, version]) => {
    const entry = packageEntry(lock, name);
    return [name, Object.freeze({ version, integrity: entry?.integrity ?? null })];
  })));

  const binding = Object.freeze({
    schema: 'omegavault.dependency-lock.v1',
    packageJsonSha256: sha256Text(packageJsonText),
    packageLockSha256: sha256Text(packageLockText),
    nodeEngine: pkg?.engines?.node ?? null,
    lockfileVersion: lock?.lockfileVersion ?? null,
    manifest
  });

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    binding: Object.freeze({ ...binding, sha256: sha256Text(JSON.stringify(binding)) })
  });
}

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) return Object.freeze({ available: false, version: null });
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return Object.freeze({ available: true, version: text.split(/\r?\n/)[0] || null });
}

function installedPackageVersion(root, name) {
  const path = join(root, 'node_modules', ...name.split('/'), 'package.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')).version ?? null; }
  catch { return null; }
}

export function createWorkstationResumeReport(projectRoot) {
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageLockPath = join(projectRoot, 'package-lock.json');
  if (!existsSync(packageJsonPath) || !existsSync(packageLockPath)) throw new Error('Workstation preflight requires package.json and package-lock.json.');
  const packageJsonText = readFileSync(packageJsonPath, 'utf8');
  const packageLockText = readFileSync(packageLockPath, 'utf8');
  const lock = verifyPackageLockIntegrity({ packageJsonText, packageLockText });
  const pins = lock.binding.manifest;
  const installed = Object.freeze(Object.fromEntries(Object.keys(pins).map(name => [name, installedPackageVersion(projectRoot, name)])));
  const missingPackages = Object.freeze(Object.entries(installed).filter(([, version]) => version == null).map(([name]) => name));
  const mismatchedPackages = Object.freeze(Object.entries(installed).filter(([name, version]) => version != null && version !== pins[name].version).map(([name, version]) => Object.freeze({ name, expected: pins[name].version, installed: version })));
  const tools = Object.freeze({
    node: Object.freeze({ available: true, version: process.version }),
    npm: commandVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm'),
    rustc: commandVersion('rustc'),
    cargo: commandVersion('cargo'),
    solana: commandVersion('solana'),
    aiken: commandVersion(process.platform === 'win32' ? 'aiken.exe' : 'aiken'),
    bitcoinCli: commandVersion(process.platform === 'win32' ? 'bitcoin-cli.exe' : 'bitcoin-cli')
  });
  return Object.freeze({
    schema: 'omegavault.workstation-resume.v1',
    projectRoot,
    dependencyLock: lock,
    installed,
    missingPackages,
    mismatchedPackages,
    tools,
    npmCiRecommended: lock.ok && (missingPackages.length > 0 || mismatchedPackages.length > 0),
    readyForPinnedNodeSuites: lock.ok && missingPackages.length === 0 && mismatchedPackages.length === 0
  });
}
