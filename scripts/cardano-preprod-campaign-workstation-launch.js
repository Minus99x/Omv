import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkstationResumeReport } from '../src/core/dependency-integrity.js';
import { verifyWorkstationCheckpointSource } from '../src/core/workstation-checkpoint-gate.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
}

const projectRoot = resolve(arg('--project-root', '.'));
const bundleDirArg = arg('--bundle-dir');

if (!bundleDirArg) {
  process.stderr.write('Cardano Preprod campaign workstation launch requires --bundle-dir pointing to the extracted sealed checkpoint artifact.\n');
  process.exitCode = 2;
} else {
  try {
    const bundleDir = resolve(bundleDirArg);
    const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
    const base = `omegavault-mvp-${pkg.version}`;
    const manifestPath = join(bundleDir, `${base}.checkpoint-manifest.json`);
    const archivePath = join(bundleDir, `${base}.zip`);
    const reviewIndexPath = join(bundleDir, `${base}.review-index.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    const sourceGate = verifyWorkstationCheckpointSource({
      projectRoot,
      checkpointManifest: manifest,
      sourceArchivePath: archivePath
    });
    if (!sourceGate.ok) throw new Error(`Checkpoint source gate failed: ${sourceGate.errors.join('; ')}`);

    const review = run(process.execPath, [
      'scripts/verify-external-review-index.js',
      '--index', reviewIndexPath,
      '--archive', archivePath,
      '--checkpoint-manifest', manifestPath
    ], projectRoot);
    if (review.status !== 0) throw new Error(`External review-index verification failed: ${review.stderr || review.stdout}`);

    const workstation = createWorkstationResumeReport(projectRoot);
    if (!workstation.dependencyLock.ok || !workstation.readyForPinnedNodeSuites) {
      const repair = workstation.npmCiRecommended ? ' Run npm ci, then repeat the launch gate.' : '';
      throw new Error(`Pinned workstation dependencies are not ready.${repair}`);
    }

    const campaign = resolve(arg('--campaign', join(resolve(projectRoot, '..'), 'omegavault-cardano-preprod-campaign')));
    const prepared = run(process.execPath, [
      'scripts/prepare-cardano-preprod-campaign.js',
      '--output', campaign
    ], projectRoot);
    if (prepared.status !== 0) throw new Error(`Campaign preparation failed: ${prepared.stderr || prepared.stdout}`);
    const preparation = JSON.parse(prepared.stdout);

    if (!/^[0-9a-f]{64}$/i.test(String(preparation.campaignSha256 ?? '')) ||
        !/^[0-9a-f]{64}$/i.test(String(preparation.invariantProgramSha256 ?? ''))) {
      throw new Error('Campaign preparation did not return valid campaign/invariant identities.');
    }
    if (preparation.sessionCount !== 4 ||
        preparation.supportClaimAuthorized !== false ||
        preparation.walletSigningAuthorized !== false ||
        preparation.transactionSubmissionAuthorized !== false ||
        preparation.networkRequestsPerformed !== false) {
      throw new Error('Campaign preparation attempted to weaken the workstation authority boundary.');
    }

    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-campaign-workstation-launch.v1',
      ok: true,
      checkpointRef: sourceGate.checkpointRef,
      checkpointArchiveSha256: sourceGate.archiveSha256,
      sourceTreeSha256: sourceGate.sourceTreeSha256,
      dependencyLockSha256: sourceGate.dependencyLockSha256,
      externalReviewVerified: true,
      pinnedDependenciesReady: true,
      campaign,
      campaignSha256: preparation.campaignSha256,
      invariantProgramSha256: preparation.invariantProgramSha256,
      sessionCount: preparation.sessionCount,
      actions: preparation.actions,
      networkRequestsPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      nextCommand: `npm run cardano:preprod:campaign:verify -- --campaign "${campaign}"`
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano Preprod campaign workstation launch blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
