import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCardanoPreprodLiveProtocolSnapshot } from '../src/chains/cardano/live-protocol-parameters.js';
import {
  cardanoSameTip,
  createCardanoOgmiosHttpClient,
  fetchCardanoBlockfrostPreprodProtocolParameters,
  parseCardanoOgmiosBlockHeightResponse,
  parseCardanoOgmiosEpochResponse,
  parseCardanoOgmiosProtocolParametersResponse,
  parseCardanoOgmiosTipResponse
} from '../src/chains/cardano/preprod-live-capture.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true });
}

async function rpcTip(client) {
  return parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
}

async function captureStableProtocolContext(client, blockfrostProjectId, retries) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const tipBefore = await rpcTip(client);
    const epoch = parseCardanoOgmiosEpochResponse(await client.rpc('queryLedgerState/epoch'));
    const height = parseCardanoOgmiosBlockHeightResponse(await client.rpc('queryNetwork/blockHeight'));
    const ogmiosParameters = parseCardanoOgmiosProtocolParametersResponse(await client.rpc('queryLedgerState/protocolParameters'));
    const tipAfter = await rpcTip(client);
    if (!cardanoSameTip(tipBefore, tipAfter)) continue;

    const blockfrostParameters = await fetchCardanoBlockfrostPreprodProtocolParameters({ projectId: blockfrostProjectId });
    const snapshot = createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters,
      blockfrostParameters,
      epoch,
      tip: tipAfter,
      blockHeight: height
    });
    return { snapshot, epoch, ogmiosParameters, blockfrostParameters };
  }
  throw new Error(`Could not obtain a stable Preprod protocol-parameter tip after ${retries} attempts.`);
}

async function evaluateAtStableTip({ client, request, retries }) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const tipBefore = await rpcTip(client);
    const epoch = parseCardanoOgmiosEpochResponse(await client.rpc('queryLedgerState/epoch'));
    const evaluation = await client.rpc(request.method, request.params, request.id);
    const tipAfter = await rpcTip(client);
    if (cardanoSameTip(tipBefore, tipAfter)) return { tip: tipAfter, epoch, evaluation, attempt };
  }
  throw new Error(`Ogmios evaluation could not be bracketed by one stable Preprod tip after ${retries} attempts.`);
}

const projectRoot = resolve(arg('--project-root', '.'));
const campaignArg = arg('--campaign');
const ogmiosUrl = arg('--ogmios-url', process.env.OMEGAVAULT_OGMIOS_URL ?? null);
const ogmiosApiKey = arg('--ogmios-api-key', process.env.OMEGAVAULT_OGMIOS_API_KEY ?? null);
const ogmiosApiKeyHeader = arg('--ogmios-api-key-header', process.env.OMEGAVAULT_OGMIOS_API_KEY_HEADER ?? 'dmtr-api-key');
const blockfrostProjectId = arg('--blockfrost-project-id', process.env.BLOCKFROST_PROJECT_ID ?? null);
const retries = Number(arg('--stable-tip-retries', '8'));

if (!campaignArg) {
  process.stderr.write('Live Cardano Preprod evaluation capture requires --campaign pointing to a new campaign directory.\n');
  process.exitCode = 2;
} else if (!ogmiosUrl) {
  process.stderr.write('Set OMEGAVAULT_OGMIOS_URL (or --ogmios-url) to a Cardano Preprod Ogmios HTTP endpoint.\n');
  process.exitCode = 2;
} else if (!blockfrostProjectId) {
  process.stderr.write('Set BLOCKFROST_PROJECT_ID (or --blockfrost-project-id) to a Cardano Preprod Blockfrost project key.\n');
  process.exitCode = 2;
} else if (!Number.isInteger(retries) || retries < 1 || retries > 30) {
  process.stderr.write('--stable-tip-retries must be an integer from 1 through 30.\n');
  process.exitCode = 2;
} else {
  try {
    const campaign = resolve(campaignArg);
    const client = createCardanoOgmiosHttpClient({
      url: ogmiosUrl,
      apiKey: ogmiosApiKey,
      apiKeyHeader: ogmiosApiKeyHeader
    });

    const live = await captureStableProtocolContext(client, blockfrostProjectId, retries);
    await mkdir(campaign, { recursive: true });
    const protocolPath = join(campaign, 'current-preprod-protocol-parameters.json');
    await writeFile(protocolPath, `${JSON.stringify(live.snapshot, null, 2)}\n`);

    const prepared = runNode([
      'scripts/prepare-cardano-preprod-campaign.js',
      '--output', campaign,
      '--protocol-parameters', protocolPath
    ], projectRoot);
    if (prepared.status !== 0) throw new Error(`Campaign preparation failed: ${prepared.stderr || prepared.stdout}`);
    const preparation = JSON.parse(prepared.stdout);

    const campaignManifest = JSON.parse(await readFile(join(campaign, 'campaign-manifest.json'), 'utf8'));
    const captured = [];

    for (const entry of campaignManifest.sessions) {
      const session = resolve(campaign, entry.directory);
      const manifest = JSON.parse(await readFile(join(session, 'capture-manifest.json'), 'utf8'));
      const request = JSON.parse(await readFile(join(session, manifest.files.evaluationRequest), 'utf8'));
      const stable = await evaluateAtStableTip({ client, request, retries });

      if (stable.epoch !== live.epoch) {
        throw new Error(`Preprod epoch changed during campaign capture (${live.epoch} -> ${stable.epoch}); restart with a new campaign directory.`);
      }

      const perSessionProtocol = createCardanoPreprodLiveProtocolSnapshot({
        ogmiosParameters: live.ogmiosParameters,
        blockfrostParameters: live.blockfrostParameters,
        epoch: stable.epoch,
        tip: stable.tip
      });

      const captures = {
        acquiredTip: {
          hash: stable.tip.hash,
          epoch: stable.epoch,
          slot: stable.tip.slot
        },
        protocolParameters: perSessionProtocol,
        ogmiosEvaluation: {
          tipBeforeHash: stable.tip.hash,
          tipAfterHash: stable.tip.hash,
          syntheticSupplementalUtxoContext: true,
          walletSigningPerformed: false,
          transactionSubmissionPerformed: false,
          response: stable.evaluation
        }
      };

      for (const [key, value] of Object.entries(captures)) {
        const target = join(session, manifest.files[key]);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
      }

      const verified = runNode(['scripts/verify-cardano-preprod-session.js', '--session', session], projectRoot);
      if (verified.status !== 0) throw new Error(`${entry.action} session verification failed: ${verified.stderr || verified.stdout}`);
      const report = JSON.parse(verified.stdout);
      if (report.fullPhaseOneValidated !== false ||
          report.walletSigningAuthorized !== false ||
          report.transactionSubmissionAuthorized !== false ||
          report.publicNetworkRecoveryProven !== false ||
          report.supportClaimAuthorized !== false) {
        throw new Error(`${entry.action} session attempted to cross the evaluation-only authority boundary.`);
      }
      captured.push({
        action: entry.action,
        tipHash: stable.tip.hash,
        tipSlot: stable.tip.slot,
        evaluationAttempt: stable.attempt,
        evidenceSha256: report.evidenceSha256,
        resultSha256: report.resultSha256
      });
    }

    const verifiedCampaign = runNode(['scripts/verify-cardano-preprod-campaign.js', '--campaign', campaign], projectRoot);
    if (verifiedCampaign.status !== 0) throw new Error(`Campaign verification failed: ${verifiedCampaign.stderr || verifiedCampaign.stdout}`);
    const campaignReport = JSON.parse(verifiedCampaign.stdout);
    if (campaignReport.fullPhaseOneValidated !== false ||
        campaignReport.walletSigningAuthorized !== false ||
        campaignReport.transactionSubmissionAuthorized !== false ||
        campaignReport.publicNetworkRecoveryProven !== false ||
        campaignReport.supportClaimAuthorized !== false) {
      throw new Error('Campaign verification attempted to cross the evaluation-only authority boundary.');
    }

    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-live-evaluation-campaign.v1',
      ok: true,
      network: 'preprod',
      campaign,
      campaignSha256: preparation.campaignSha256,
      invariantProgramSha256: preparation.invariantProgramSha256,
      independentlyConfirmedProtocolSources: 2,
      captured,
      state: campaignReport.state,
      synchronizedEvaluationCampaignComplete: true,
      fullPhaseOneValidated: false,
      networkRequestsPerformed: true,
      walletSigningPerformed: false,
      transactionSubmissionPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false,
      hardStop: 'STOP. Final transaction construction, full phase-1 validation, wallet signing, submission, inclusion/finality and public-network recovery remain separately gated.'
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano Preprod live evaluation campaign blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
