import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspectDependencyLock, verifyDependencyEvidence } from '../src/core/dependency-integrity.js';

const packageJsonText = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const packageLockText = fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8');

test('dependency lock is exact, complete, registry-pinned and integrity-bound', () => {
  const report = inspectDependencyLock({ packageJsonText, packageLockText });
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.lockfileVersion, 3);
  assert.ok(report.packageCount > 100);
  assert.deepEqual(report.installScriptPackages, ['@aiken-lang/aiken']);
});

test('dependency evidence binds both manifests and the complete lock graph summary', () => {
  const report = inspectDependencyLock({ packageJsonText, packageLockText });
  const evidence = JSON.parse(fs.readFileSync(new URL('../docs/evidence/DEPENDENCY_LOCK_0.6.29.json', import.meta.url), 'utf8'));
  assert.equal(verifyDependencyEvidence(report, evidence), true);
  assert.equal(verifyDependencyEvidence(report, { ...evidence, packageCount: evidence.packageCount + 1 }), false);
});

test('dependency inspection rejects ranges, untrusted registry URLs and missing integrity', () => {
  const pkg = JSON.parse(packageJsonText);
  const lock = JSON.parse(packageLockText);
  pkg.dependencies.bs58 = '^6.0.0';
  lock.packages[''].dependencies.bs58 = '^6.0.0';
  lock.packages['node_modules/bs58'].resolved = 'http://example.invalid/bs58.tgz';
  delete lock.packages['node_modules/xrpl'].integrity;
  const report = inspectDependencyLock({ packageJsonText: JSON.stringify(pkg), packageLockText: JSON.stringify(lock) });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => error.includes('exact semantic version')));
  assert.ok(report.errors.some(error => error.includes('HTTPS npm registry')));
  assert.ok(report.errors.some(error => error.includes('SHA-512 integrity')));
});
