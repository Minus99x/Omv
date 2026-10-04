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
  process.stderr.write('Cardano Preprod workstation launch requires --bundle-dir pointing to the extracted sealed checkpoint artifact.\n');
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

    const action = arg('--action', 'execute');
    const session = resolve(arg('--session', join(resolve(projectRoot, '..'), 'omegavault-cardano-preprod-session')));
    const prepared = run(process.execPath, [
      'scripts/prepare-cardano-preprod-session.js',
      '--output', session,
      '--action', action
    ], projectRoot);
    if (prepared.status !== 0) throw new Error(`Capture-session preparation failed: ${prepared.stderr || prepared.stdout}`);
    const preparation = JSON.parse(prepared.stdout);

    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-workstation-launch.v1',
      ok: true,
      checkpointRef: sourceGate.checkpointRef,
      checkpointArchiveSha256: sourceGate.archiveSha256,
      sourceTreeSha256: sourceGate.sourceTreeSha256,
      dependencyLockSha256: sourceGate.dependencyLockSha256,
      externalReviewVerified: true,
      pinnedDependenciesReady: true,
      session,
      sessionManifestSha256: preparation.manifestSha256,
      transactionBodyHash: preparation.transactionBodyHash,
      networkRequestsPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      nextCommand: `npm run cardano:preprod:verify -- --session "${session}"`
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano Preprod workstation launch blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
