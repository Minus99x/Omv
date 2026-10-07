import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SEALED_CHECKPOINT = Object.freeze({
  ref: '0.6.59-dev',
  commit: '1353fe9fd94fcbdd787fd594c85937e934b60571',
  sourceTreeSha256: '63eadd3755dc029b361b2bb5fe10aee4ea2ef072ea23891ab0a6d56f5bda8ba6'
});

const REQUIRED_ACTIONS = Object.freeze(['initialize', 'heartbeat', 'approve', 'execute']);
const REQUIRED_CAPTURE_KEYS = Object.freeze([
  'acquiredTip',
  'protocolParameters',
  'ogmiosEvaluation'
]);

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function binary(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return Object.freeze({
    available: result.status === 0,
    version: result.status === 0 ? String(result.stdout || result.stderr).trim().split(/\r?\n/)[0] : null
  });
}

async function inspectCampaign(campaignRoot) {
  if (!campaignRoot) return Object.freeze({ supplied: false, exists: false, structurallyReady: false, actions: [], incomplete: [] });
  const root = resolve(campaignRoot);
  const campaignPath = join(root, 'campaign-manifest.json');
  if (!await exists(campaignPath)) {
    return Object.freeze({ supplied: true, exists: false, root, structurallyReady: false, actions: [], incomplete: [] });
  }

  const campaign = JSON.parse(await readFile(campaignPath, 'utf8'));
  const actions = (campaign.sessions ?? []).map(item => item.action);
  const exactActions = actions.length === REQUIRED_ACTIONS.length && REQUIRED_ACTIONS.every((action, index) => actions[index] === action);
  const incomplete = [];

  for (const entry of campaign.sessions ?? []) {
    const sessionRoot = resolve(root, entry.directory);
    const captureManifestPath = join(sessionRoot, 'capture-manifest.json');
    if (!await exists(captureManifestPath)) {
      incomplete.push({ action: entry.action, missing: ['capture-manifest.json'] });
      continue;
    }
    const manifest = JSON.parse(await readFile(captureManifestPath, 'utf8'));
    const missing = [];
    for (const key of REQUIRED_CAPTURE_KEYS) {
      const relative = manifest.files?.[key];
      if (!relative || !await exists(join(sessionRoot, relative))) missing.push(relative ?? key);
    }
    if (missing.length) incomplete.push({ action: entry.action, missing });
  }

  return Object.freeze({
    supplied: true,
    exists: true,
    root,
    structurallyReady: exactActions,
    campaignSha256: campaign.campaignSha256 ?? null,
    invariantProgramSha256: campaign.invariantProgramSha256 ?? null,
    actions,
    incomplete
  });
}

async function inspectBundle(bundleDir) {
  if (!bundleDir) return Object.freeze({ supplied: false, complete: false, missing: [] });
  const root = resolve(bundleDir);
  const base = 'omegavault-mvp-0.6.59-dev';
  const required = [
    `${base}.zip`,
    `${base}.checkpoint-manifest.json`,
    `${base}.review-index.json`
  ];
  const missing = [];
  for (const name of required) if (!await exists(join(root, name))) missing.push(name);
  return Object.freeze({ supplied: true, root, complete: missing.length === 0, missing });
}

const projectRoot = resolve(arg('--project-root', '.'));
const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const campaign = await inspectCampaign(arg('--campaign'));
const bundle = await inspectBundle(arg('--bundle-dir'));

const tools = Object.freeze({
  node: Object.freeze({ available: true, version: process.version }),
  npm: binary(process.platform === 'win32' ? 'npm.cmd' : 'npm'),
  git: binary('git'),
  docker: binary('docker'),
  cardanoCli: binary('cardano-cli')
});

const report = Object.freeze({
  schema: 'omegavault.cardano.preprod-operator-handoff.v2',
  ok: true,
  projectVersion: packageJson.version,
  sealedCheckpoint: SEALED_CHECKPOINT,
  network: Object.freeze({
    name: 'Cardano Preprod',
    networkId: 0,
    networkMagic: 1,
    addressPrefix: 'addr_test1'
  }),
  tools,
  fastestInfrastructurePath: Object.freeze({
    mode: 'managed-ogmios-plus-independent-http-providers',
    localCardanoNodeRequired: false,
    dockerRequired: false,
    fullChainSyncRequired: false,
    managedOgmiosEndpointRequired: true,
    independentProtocolParameterSourcesRequired: 2,
    suggestedIndependentSources: Object.freeze(['Koios Preprod', 'Blockfrost Preprod'])
  }),
  selfHostedFallback: Object.freeze({
    mode: 'docker-cardano-node-plus-ogmios',
    dockerRequired: true,
    localCardanoNodeRequired: true,
    fullChainSyncRequired: true,
    ogmiosPort: 1337
  }),
  currentMilestone: Object.freeze({
    name: 'first-real-preprod-initialize-capture',
    primaryCommand: 'npm.cmd run cardano:preprod:real-initialize:guided',
    actualWalletUtxosRequired: true,
    requiredPlainAdaOnlyUtxos: 2,
    networkWritesPerformedByMilestone: false,
    walletSigningAuthorized: false,
    transactionSubmissionAuthorized: false
  }),
  faucet: Object.freeze({
    network: 'preprod',
    requiredForCurrentSynchronizedEvaluationOnlyGate: false,
    requiredForCurrentRealInitializeGate: true,
    recommendedToPrepareDedicatedTestWalletNow: true,
    requiredBeforeAnyLaterSignedPublicNetworkTransactionGate: true,
    preprodTestAdaRequired: true,
    realAdaRequired: false,
    mainnetWalletOrSeedShouldBeUsed: false
  }),
  bundle,
  campaign,
  operatorBoundary: Object.freeze({
    networkCaptureAuthorized: true,
    walletSigningAuthorized: false,
    transactionSubmissionAuthorized: false,
    liveValueMovementAuthorized: false,
    inclusionOrFinalityClaimAuthorized: false,
    publicNetworkRecoveryClaimAuthorized: false,
    supportClaimAuthorized: false
  }),
  currentEvidenceScope: Object.freeze({
    campaignPurpose: 'first real Preprod initialize read/evaluation capture from actual wallet UTxOs',
    priorSyntheticCampaignComplete: true,
    fixtureCandidatesAreNotPublicNetworkRecoveryProof: true,
    realInitializeEndsUnsigned: true,
    fullPhaseOneValidationRemainsSeparateLaterGate: true,
    signingAndSubmissionRemainSeparateLaterGates: true
  }),
  nextCommands: Object.freeze({
    guidedRealInitialize: 'npm.cmd run cardano:preprod:real-initialize:guided',
    directRealInitialize: 'npm.cmd run cardano:preprod:real-initialize:capture -- --wallet-address "<OWNER-ADDR_TEST1>" --recovery-config "<RECOVERY-CONFIG.JSON>" --output "<NEW-REAL-INITIALIZE-CAPTURE-DIR>"',
    inspectHandoff: 'npm.cmd run cardano:preprod:operator:handoff',
    legacyEvaluationCampaignLaunch: 'npm.cmd run cardano:preprod:campaign:launch -- --bundle-dir "<sealed-0.6.59-bundle-dir>" --campaign "<campaign-dir>"',
    legacyVerifyCampaign: 'npm.cmd run cardano:preprod:campaign:verify -- --campaign "<campaign-dir>"'
  }),
  networkRequestsPerformed: false
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
