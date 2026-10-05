import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createCheckpointManifest, createSourceTreeInventory } from '../src/core/checkpoint-manifest.js';
import { verifyPackageLockIntegrity } from '../src/core/dependency-integrity.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = args => spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });

function makeBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-evaluation-gate-bundle-'));
  const pkgText = fs.readFileSync('package.json', 'utf8');
  const lockText = fs.readFileSync('package-lock.json', 'utf8');
  const pkg = JSON.parse(pkgText);
  const base = `omegavault-mvp-${pkg.version}`;
  const archive = path.join(dir, `${base}.zip`);
  const manifestPath = path.join(dir, `${base}.checkpoint-manifest.json`);
  const indexPath = path.join(dir, `${base}.review-index.json`);
  fs.writeFileSync(archive, 'evaluation-workstation-gate-fixture');

  const lock = verifyPackageLockIntegrity({ packageJsonText: pkgText, packageLockText: lockText });
  const inventory = createSourceTreeInventory(process.cwd());
  const manifest = createCheckpointManifest({
    checkpoint: { ref: pkg.version, archive: path.basename(archive), archiveSha256: sha(fs.readFileSync(archive)) },
    dependencyLock: lock.binding,
    sourceInventory: inventory
  });
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, sourceInventory: inventory }, null, 2)}\n`);

  const generated = run(['scripts/generate-external-review-index.js', '--archive', archive, '--checkpoint-manifest', manifestPath, '--output', indexPath]);
  assert.equal(generated.status, 0, generated.stderr);
  return { dir };
}

test('Cardano evaluation workstation gate verifies sealed source and stops before network/campaign work', () => {
  const bundle = makeBundle();
  const campaign = path.join(os.tmpdir(), `omegavault-live-campaign-${process.pid}`);
  const gated = run([
    'scripts/cardano-preprod-evaluation-workstation-gate.js',
    '--bundle-dir', bundle.dir,
    '--campaign', campaign
  ]);
  assert.equal(gated.status, 0, gated.stderr);
  const report = JSON.parse(gated.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.externalReviewVerified, true);
  assert.equal(report.pinnedDependenciesReady, true);
  assert.equal(report.networkRequestsPerformed, false);
  assert.equal(report.walletSigningAuthorized, false);
  assert.equal(report.transactionSubmissionAuthorized, false);
  assert.equal(report.supportClaimAuthorized, false);
  assert.deepEqual(report.requiredEnvironment, ['OMEGAVAULT_OGMIOS_URL', 'BLOCKFROST_PROJECT_ID']);
  assert.match(report.nextCommand, /cardano:preprod:campaign:capture/);
  assert.equal(fs.existsSync(path.join(campaign, 'campaign-manifest.json')), false);
  fs.rmSync(bundle.dir, { recursive: true, force: true });
});
