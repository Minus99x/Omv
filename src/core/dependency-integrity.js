import { createHash } from 'node:crypto';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const REGISTRY_TARBALL = /^https:\/\/registry\.npmjs\.org\//;

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch (error) { throw new TypeError(`${label} is not valid JSON: ${error.message}`); }
}

function sortedObject(value = {}) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function packageNameFromPath(path) {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  return index === -1 ? path : path.slice(index + marker.length);
}

export function inspectDependencyLock({ packageJsonText, packageLockText, installedVersions = null }) {
  const pkg = parseJson(packageJsonText, 'package.json');
  const lock = parseJson(packageLockText, 'package-lock.json');
  const errors = [];
  const declared = sortedObject({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  const root = lock.packages?.[''];

  if (lock.lockfileVersion !== 3) errors.push('package-lock.json must use lockfileVersion 3.');
  if (!root) errors.push('package-lock.json is missing its root package entry.');
  if (root?.name !== pkg.name || root?.version !== pkg.version) errors.push('Root package name/version does not match package.json.');
  if (JSON.stringify(sortedObject({ ...(root?.dependencies ?? {}), ...(root?.devDependencies ?? {}) })) !== JSON.stringify(declared)) {
    errors.push('Root lockfile dependencies do not exactly match package.json.');
  }

  for (const [name, version] of Object.entries(declared)) {
    if (!EXACT_VERSION.test(version)) errors.push(`Direct dependency ${name} must use an exact semantic version.`);
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry) errors.push(`Direct dependency ${name} is missing from the lockfile package graph.`);
    else if (entry.version !== version) errors.push(`Direct dependency ${name} resolved to ${entry.version} instead of ${version}.`);
    if (installedVersions && installedVersions[name] !== version) {
      errors.push(`Installed dependency ${name} is ${installedVersions[name] ?? 'missing'} instead of ${version}.`);
    }
  }

  const packageEntries = Object.entries(lock.packages ?? {}).filter(([path]) => path !== '');
  const installScriptPackages = [];
  for (const [path, entry] of packageEntries) {
    if (!path.includes('node_modules/')) errors.push(`Unexpected non-registry package path: ${path}.`);
    if (!entry?.version) errors.push(`Locked package ${path} is missing a version.`);
    if (!REGISTRY_TARBALL.test(entry?.resolved ?? '')) errors.push(`Locked package ${path} is not pinned to the HTTPS npm registry.`);
    if (!SHA512_INTEGRITY.test(entry?.integrity ?? '')) errors.push(`Locked package ${path} is missing SHA-512 integrity.`);
    if (entry?.hasInstallScript === true) installScriptPackages.push(packageNameFromPath(path));
  }

  return Object.freeze({
    ok: errors.length === 0,
    packageJsonSha256: sha256(packageJsonText),
    packageLockSha256: sha256(packageLockText),
    lockfileVersion: lock.lockfileVersion,
    packageCount: packageEntries.length,
    directDependencies: Object.freeze(declared),
    installScriptPackages: Object.freeze([...new Set(installScriptPackages)].sort()),
    installedTreeChecked: installedVersions != null,
    errors: Object.freeze(errors)
  });
}

export function verifyDependencyEvidence(report, evidence) {
  if (!report?.ok || !evidence) return false;
  return evidence.schema === 'omegavault.dependency-lock.v1'
    && evidence.packageJsonSha256 === report.packageJsonSha256
    && evidence.packageLockSha256 === report.packageLockSha256
    && evidence.lockfileVersion === report.lockfileVersion
    && evidence.packageCount === report.packageCount
    && JSON.stringify(evidence.directDependencies) === JSON.stringify(report.directDependencies)
    && JSON.stringify(evidence.installScriptPackages) === JSON.stringify(report.installScriptPackages);
}
