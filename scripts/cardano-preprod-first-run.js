import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const bundleDir = arg('--bundle-dir');
const sealedSource = arg('--sealed-source');
const campaign = resolve(arg('--campaign', resolve('..', 'omegavault-cardano-preprod-live-campaign')));

if (!bundleDir) {
  process.stderr.write('Cardano Preprod first run requires --bundle-dir pointing to the sealed artifact bundle.\n');
  process.exitCode = 2;
} else {
  const gateArgs = [
    'scripts/cardano-preprod-evaluation-workstation-gate.js',
    '--bundle-dir', resolve(bundleDir),
    '--campaign', campaign
  ];
  if (sealedSource) gateArgs.push('--sealed-source', resolve(sealedSource));

  const result = spawnSync(process.execPath, gateArgs, { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exitCode = 2;
  } else {
    const gate = JSON.parse(result.stdout);
    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-first-run.v3',
      ok: true,
      checkpointRef: gate.checkpointRef,
      checkpointArchiveSha256: gate.checkpointArchiveSha256,
      sealedSourceRoot: gate.sealedSourceRoot,
      sealedSourceTreeSha256: gate.sealedSourceTreeSha256,
      sealedDependencyLockSha256: gate.sealedDependencyLockSha256,
      toolingRoot: gate.toolingRoot,
      toolingPackageVersion: gate.toolingPackageVersion,
      toolingSourceTreeSha256: gate.toolingSourceTreeSha256,
      externalReviewVerified: gate.externalReviewVerified,
      pinnedDependenciesReady: gate.pinnedDependenciesReady,
      campaign,
      requiredEnvironment: gate.requiredEnvironment,
      optionalEnvironment: gate.optionalEnvironment,
      nextCommand: gate.nextCommand,
      networkRequestsPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      hardStop: gate.hardStop
    }, null, 2)}\n`);
  }
}
