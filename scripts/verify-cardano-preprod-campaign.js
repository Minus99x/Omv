import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyCardanoPreprodCampaignManifest } from '../src/chains/cardano/preprod-campaign.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const campaignRoot = resolve(arg('--campaign', 'omegavault-cardano-preprod-campaign'));
const campaignPath = join(campaignRoot, 'campaign-manifest.json');

if (!await exists(campaignPath)) {
  process.stderr.write('Cardano Preprod campaign manifest is missing. Run cardano:preprod:campaign:prepare first.\n');
  process.exitCode = 2;
} else {
  try {
    const campaign = await readJson(campaignPath);
    const sessionManifests = {};
    const sessionDirectories = {};

    for (const entry of campaign.sessions ?? []) {
      const sessionDirectory = resolve(campaignRoot, entry.directory);
      const manifestPath = join(sessionDirectory, 'capture-manifest.json');
      if (!await exists(manifestPath)) throw new Error(`${entry.action} capture manifest is missing.`);
      sessionManifests[entry.action] = await readJson(manifestPath);
      sessionDirectories[entry.action] = sessionDirectory;
    }

    const campaignCheck = verifyCardanoPreprodCampaignManifest(campaign, { sessionManifests });
    if (!campaignCheck.valid) throw new Error(campaignCheck.errors.join('; '));

    const incomplete = [];
    for (const entry of campaign.sessions) {
      const manifest = sessionManifests[entry.action];
      const missing = [];
      for (const key of ['acquiredTip', 'utxoSnapshot', 'protocolParameters', 'ogmiosEvaluation', 'phaseOneValidation']) {
        if (!await exists(join(sessionDirectories[entry.action], manifest.files[key]))) missing.push(manifest.files[key]);
      }
      if (missing.length) incomplete.push({ action: entry.action, missing });
    }

    if (incomplete.length) {
      process.stdout.write(`${JSON.stringify({
        schema: 'omegavault.cardano.preprod-campaign-status.v1',
        ok: false,
        state: 'campaign-capture-incomplete',
        campaignRoot,
        campaignSha256: campaign.campaignSha256,
        invariantProgramSha256: campaign.invariantProgramSha256,
        incomplete,
        completedActions: campaign.sessions.filter(entry => !incomplete.some(item => item.action === entry.action)).map(entry => entry.action),
        synchronizedEvaluationCampaignComplete: false,
        networkRequestsPerformed: false,
        walletSigningAuthorized: false,
        transactionSubmissionAuthorized: false,
        publicNetworkRecoveryProven: false,
        supportClaimAuthorized: false
      }, null, 2)}\n`);
      process.exitCode = 2;
    } else {
      const results = [];
      for (const entry of campaign.sessions) {
        const verified = run(process.execPath, [
          'scripts/verify-cardano-preprod-session.js',
          '--session', sessionDirectories[entry.action]
        ], process.cwd());
        if (verified.status !== 0) throw new Error(`${entry.action} synchronized session verification failed: ${verified.stderr || verified.stdout}`);
        const report = JSON.parse(verified.stdout);
        if (report.supportClaimAuthorized !== false ||
            report.walletSigningAuthorized !== false ||
            report.transactionSubmissionAuthorized !== false ||
            report.publicNetworkRecoveryProven !== false ||
            report.invariantLifecycleProgramComplete !== false) {
          throw new Error(`${entry.action} session attempted to weaken the campaign authority boundary.`);
        }
        results.push({
          action: entry.action,
          state: report.state,
          evidenceSha256: report.evidenceSha256,
          resultSha256: report.resultSha256
        });
      }

      process.stdout.write(`${JSON.stringify({
        schema: 'omegavault.cardano.preprod-campaign-status.v1',
        ok: true,
        state: 'synchronized-evaluation-campaign-ready',
        campaignRoot,
        campaignSha256: campaign.campaignSha256,
        invariantProgramSha256: campaign.invariantProgramSha256,
        results,
        synchronizedEvaluationCampaignComplete: true,
        invariantLifecycleProgramComplete: false,
        networkRequestsPerformed: false,
        walletSigningAuthorized: false,
        transactionSubmissionAuthorized: false,
        publicNetworkRecoveryProven: false,
        supportClaimAuthorized: false,
        nextLiveGate: 'wallet-signing-submission-finality-and-public-network-recovery-remain-separate'
      }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`Cardano Preprod campaign verification failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}
