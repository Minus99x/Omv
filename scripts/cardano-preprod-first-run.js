import { access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true });
}

const projectRoot = resolve(arg('--project-root', '.'));
const bundleDirArg = arg('--bundle-dir');
const campaignArg = arg('--campaign');

if (!bundleDirArg || !campaignArg) {
  process.stderr.write('Cardano Preprod first run requires both --bundle-dir and --campaign.\n');
  process.exitCode = 2;
} else {
  try {
    const bundleDir = resolve(bundleDirArg);
    const campaign = resolve(campaignArg);
    const campaignManifest = join(campaign, 'campaign-manifest.json');

    if (await exists(campaignManifest)) {
      throw new Error('Campaign already exists. Refusing to overwrite or silently reuse it; run the operator handoff/verification commands against the existing campaign instead.');
    }

    const launch = runNode([
      'scripts/cardano-preprod-campaign-workstation-launch.js',
      '--project-root', projectRoot,
      '--bundle-dir', bundleDir,
      '--campaign', campaign
    ], projectRoot);

    if (launch.status !== 0) {
      throw new Error(`Strict campaign launch failed: ${launch.stderr || launch.stdout}`);
    }

    const launchReport = JSON.parse(launch.stdout);
    if (launchReport.walletSigningAuthorized !== false ||
        launchReport.transactionSubmissionAuthorized !== false ||
        launchReport.supportClaimAuthorized !== false ||
        launchReport.networkRequestsPerformed !== false) {
      throw new Error('Strict campaign launch weakened the authority boundary.');
    }

    const handoff = runNode([
      'scripts/cardano-preprod-operator-handoff.js',
      '--project-root', projectRoot,
      '--bundle-dir', bundleDir,
      '--campaign', campaign
    ], projectRoot);

    if (handoff.status !== 0) {
      throw new Error(`Operator handoff report failed: ${handoff.stderr || handoff.stdout}`);
    }

    const handoffReport = JSON.parse(handoff.stdout);

    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-first-run.v1',
      ok: true,
      checkpointRef: launchReport.checkpointRef,
      checkpointArchiveSha256: launchReport.checkpointArchiveSha256,
      sourceTreeSha256: launchReport.sourceTreeSha256,
      dependencyLockSha256: launchReport.dependencyLockSha256,
      campaign,
      campaignSha256: launchReport.campaignSha256,
      invariantProgramSha256: launchReport.invariantProgramSha256,
      actions: launchReport.actions,
      handoff: handoffReport,
      nextCommand: `npm run cardano:preprod:campaign:verify -- --campaign "${campaign}"`,
      networkRequestsPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      hardStop: 'Capture and verify synchronized Preprod evidence only. Do not sign or submit an OmegaVault Cardano transaction.'
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano Preprod first run blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
