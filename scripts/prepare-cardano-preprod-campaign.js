import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS } from '../src/chains/cardano/preprod-invariant-program.js';
import { createCardanoPreprodCampaignManifest } from '../src/chains/cardano/preprod-campaign.js';

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

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const defaultOutput = resolve(dirname(projectRoot), 'omegavault-cardano-preprod-campaign');
const output = resolve(arg('--output', defaultOutput));
const campaignPath = join(output, 'campaign-manifest.json');

if (await exists(campaignPath)) {
  throw new Error('A Cardano Preprod campaign already exists at the output path; choose a new directory rather than overwriting it.');
}

await mkdir(join(output, 'sessions'), { recursive: true });
const sessions = [];

for (const action of CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS) {
  const relativeDirectory = join('sessions', action);
  const sessionDirectory = join(output, relativeDirectory);
  const prepared = run(process.execPath, [
    'scripts/prepare-cardano-preprod-session.js',
    '--output', sessionDirectory,
    '--action', action
  ], projectRoot);
  if (prepared.status !== 0) {
    throw new Error(`Failed to prepare Cardano Preprod ${action} session: ${prepared.stderr || prepared.stdout}`);
  }
  const manifest = JSON.parse(await readFile(join(sessionDirectory, 'capture-manifest.json'), 'utf8'));
  sessions.push({ directory: relativeDirectory.replaceAll('\\', '/'), manifest });
}

const campaign = createCardanoPreprodCampaignManifest({ sessions });
await writeFile(campaignPath, `${JSON.stringify(campaign, null, 2)}\n`);

const runbook = [
  '# OmegaVault Cardano Preprod Evidence Campaign',
  '',
  `Checkpoint: ${campaign.checkpoint.checkpointRef}`,
  `Campaign SHA-256: ${campaign.campaignSha256}`,
  `Invariant program SHA-256: ${campaign.invariantProgramSha256}`,
  '',
  'Prepared lifecycle sessions:',
  ...campaign.sessions.map(item => `- ${item.action}: ${item.directory}`),
  '',
  'For each action, capture the three external evidence files named by that session manifest:',
  '- one stable acquired Preprod tip',
  '- current same-tip protocol parameters with at least two independent confirmations',
  '- Ogmios evaluation response bracketed by that same tip before and after evaluation',
  '',
  'Then run:',
  `npm run cardano:preprod:campaign:verify -- --campaign "${output}"`,
  '',
  'This campaign is public-Preprod evaluation evidence preparation only. It does not establish full phase-1 validity and does not authorize wallet signing, transaction submission, live-value movement, public-network recovery or an OmegaVault support claim.'
].join('\n');
await writeFile(join(output, 'RUNBOOK.md'), `${runbook}\n`);

process.stdout.write(`${JSON.stringify({
  schema: 'omegavault.cardano.preprod-campaign-preparation-result.v1',
  ok: true,
  output,
  campaignManifest: campaignPath,
  campaignSha256: campaign.campaignSha256,
  invariantProgramSha256: campaign.invariantProgramSha256,
  actions: campaign.requiredLifecycleActions,
  sessionCount: campaign.sessions.length,
  networkRequestsPerformed: false,
  walletSigningAuthorized: false,
  transactionSubmissionAuthorized: false,
  supportClaimAuthorized: false
}, null, 2)}\n`);
