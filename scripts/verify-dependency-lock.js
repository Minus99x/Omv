import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDependencyLock, verifyDependencyEvidence } from '../src/core/dependency-integrity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonText = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const packageLockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
const checkInstalled = process.argv.includes('--installed');
const printEvidence = process.argv.includes('--print-evidence');

const pkg = JSON.parse(packageJsonText);
const installedVersions = checkInstalled ? Object.fromEntries(
  Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).map(name => {
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    return [name, installed.version];
  })
) : null;

const report = inspectDependencyLock({ packageJsonText, packageLockText, installedVersions });
if (!report.ok) {
  for (const error of report.errors) console.error(`dependency-integrity: ${error}`);
  process.exitCode = 1;
} else if (printEvidence) {
  console.log(JSON.stringify({
    schema: 'omegavault.dependency-lock.v1',
    packageJsonSha256: report.packageJsonSha256,
    packageLockSha256: report.packageLockSha256,
    lockfileVersion: report.lockfileVersion,
    packageCount: report.packageCount,
    directDependencies: report.directDependencies,
    installScriptPackages: report.installScriptPackages
  }, null, 2));
} else {
  const evidencePath = path.join(root, 'docs', 'evidence', 'DEPENDENCY_LOCK_0.6.29.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  if (!verifyDependencyEvidence(report, evidence)) {
    console.error('dependency-integrity: evidence manifest does not match package.json/package-lock.json.');
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, packages: report.packageCount, installedTreeChecked: report.installedTreeChecked }));
  }
}
