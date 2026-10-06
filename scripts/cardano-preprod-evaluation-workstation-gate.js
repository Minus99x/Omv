import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkstationResumeReport } from '../src/core/dependency-integrity.js';
import { createSourceTreeInventory } from '../src/core/checkpoint-manifest.js';
import { verifyWorkstationCheckpointSource } from '../src/core/workstation-checkpoint-gate.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
}

const projectRoot = resolve(arg('--project-root', '.'));
const sealedSourceRoot = resolve(arg('--sealed-source', projectRoot));
const bundleDirArg = arg('--bundle-dir');
const campaign = arg('--campaign', resolve(projectRoot, '..', 'omegavault-cardano-preprod-live-campaign'));

if (!bundleDirArg) {
  process.stderr.write('Cardano Preprod evaluation workstation gate requires --bundle-dir pointing to the sealed checkpoint artifact bundle.\n');
  process.exitCode = 2;
} else {
  try {
    const bundleDir = resolve(bundleDirArg);
    const toolingPkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
    const sealedPkg = JSON.parse(await readFile(join(sealedSourceRoot, 'package.json'), 'utf8'));
    const base = `omegavault-mvp-${sealedPkg.version}`;
    const manifestPath = join(bundleDir, `${base}.checkpoint-manifest.json`);
    const archivePath = join(bundleDir, `${base}.zip`);
    const reviewIndexPath = join(bundleDir, `${base}.review-index.json`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    const sourceGate = verifyWorkstationCheckpointSource({
      projectRoot: sealedSourceRoot,
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
      const repair = workstation.npmCiRecommended ? ' Run npm ci, then repeat the gate.' : '';
      throw new Error(`Pinned workstation dependencies are not ready.${repair}`);
    }
    const toolingInventory = createSourceTreeInventory(projectRoot);

    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-evaluation-workstation-gate.v2',
      ok: true,
      checkpointRef: sourceGate.checkpointRef,
      checkpointArchiveSha256: sourceGate.archiveSha256,
      sealedSourceRoot,
      sealedSourceTreeSha256: sourceGate.sourceTreeSha256,
      sealedDependencyLockSha256: sourceGate.dependencyLockSha256,
      toolingRoot: projectRoot,
      toolingPackageVersion: toolingPkg.version,
      toolingSourceTreeSha256: toolingInventory.sha256,
      externalReviewVerified: true,
      pinnedDependenciesReady: true,
      networkRequestsPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      requiredEnvironment: [
        'OMEGAVAULT_OGMIOS_URL',
        'BLOCKFROST_PROJECT_ID'
      ],
      optionalEnvironment: [
        'OMEGAVAULT_OGMIOS_API_KEY',
        'OMEGAVAULT_OGMIOS_API_KEY_HEADER'
      ],
      nextCommand: `npm run cardano:preprod:campaign:capture -- --campaign "${resolve(campaign)}"`,
      hardStop: 'The next command may perform read/evaluation network requests only. Wallet signing and transaction submission remain unauthorized.'
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano Preprod evaluation workstation gate blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
