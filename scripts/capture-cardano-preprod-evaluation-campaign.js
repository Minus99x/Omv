import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
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
    const blockfrostParameters = await fetchCardanoBlockfrostPreprodProtocolParameters({ projectId: blockfrostProjectId });
    const tipAfter = await rpcTip(client);
    if (!cardanoSameTip(tipBefore, tipAfter)) continue;

    const snapshot = createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters,
      blockfrostParameters,
      epoch,
      tip: tipAfter,
      blockHeight: height
    });
    return { snapshot, attempt };
  }
  throw new Error(`Could not obtain a stable independently-confirmed Preprod protocol context after ${retries} attempts.`);
}

async function evaluateAtStableTip({ client, request, blockfrostProjectId, retries }) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const tipBefore = await rpcTip(client);
    const epoch = parseCardanoOgmiosEpochResponse(await client.rpc('queryLedgerState/epoch'));
    const height = parseCardanoOgmiosBlockHeightResponse(await client.rpc('queryNetwork/blockHeight'));
    const ogmiosParameters = parseCardanoOgmiosProtocolParametersResponse(await client.rpc('queryLedgerState/protocolParameters'));
    const blockfrostParameters = await fetchCardanoBlockfrostPreprodProtocolParameters({ projectId: blockfrostProjectId });
    const evaluation = await client.rpc(request.method, request.params, request.id);
    const tipAfter = await rpcTip(client);
    if (!cardanoSameTip(tipBefore, tipAfter)) continue;

    const snapshot = createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters,
      blockfrostParameters,
      epoch,
      tip: tipAfter,
      blockHeight: height
    });
    return { tip: tipAfter, epoch, evaluation, snapshot, attempt };
  }
  throw new Error(`Ogmios evaluation and independently-confirmed protocol context could not be bracketed by one stable Preprod tip after ${retries} attempts.`);
}

const projectRoot = resolve(arg('--project-root', '.'));
const campaignArg = arg('--campaign');
const bundleDirArg = arg('--bundle-dir');
const sealedSourceArg = arg('--sealed-source');
const ogmiosUrl = arg('--ogmios-url', process.env.OMEGAVAULT_OGMIOS_URL ?? null);
const ogmiosApiKey = arg('--ogmios-api-key', process.env.OMEGAVAULT_OGMIOS_API_KEY ?? null);
const ogmiosApiKeyHeader = arg('--ogmios-api-key-header', process.env.OMEGAVAULT_OGMIOS_API_KEY_HEADER ?? 'dmtr-api-key');
const blockfrostProjectId = arg('--blockfrost-project-id', process.env.BLOCKFROST_PROJECT_ID ?? null);
const retries = Number(arg('--stable-tip-retries', '8'));

if (!campaignArg) {
  process.stderr.write('Live Cardano Preprod evaluation capture requires --campaign pointing to a new campaign directory.\n');
  process.exitCode = 2;
} else if (!ogmiosUrl) {
  process.stderr.write('Set OMEGAVAULT_OGMIOS_URL (or --ogmios-url) to a Cardano Preprod Ogmios endpoint (https or wss).\n');
  process.exitCode = 2;
} else if (!blockfrostProjectId) {
  process.stderr.write('Set BLOCKFROST_PROJECT_ID (or --blockfrost-project-id) to a Cardano Preprod Blockfrost project key.\n');
  process.exitCode = 2;
} else if (!bundleDirArg) {
  process.stderr.write('Live Cardano Preprod evaluation capture requires --bundle-dir pointing to the sealed 0.6.59 checkpoint artifact bundle.\n');
  process.exitCode = 2;
} else if (!sealedSourceArg) {
  process.stderr.write('Live Cardano Preprod evaluation capture requires --sealed-source pointing to the extracted sealed 0.6.59 source tree.\n');
  process.exitCode = 2;
} else if (!Number.isInteger(retries) || retries < 1 || retries > 30) {
  process.stderr.write('--stable-tip-retries must be an integer from 1 through 30.\n');
  process.exitCode = 2;
} else {
  let client = null;
  try {
    const campaign = resolve(campaignArg);
    if (await exists(campaign)) {
      throw new Error('Live Cardano Preprod campaign destination already exists; choose a new directory so prior evidence is never overwritten or mixed.');
    }

    process.stderr.write('Live capture stage 1/4: verifying sealed workstation gate...\n');
    const gate = runNode([
      'scripts/cardano-preprod-evaluation-workstation-gate.js',
      '--bundle-dir', resolve(bundleDirArg),
      '--sealed-source', resolve(sealedSourceArg),
      '--campaign', campaign
    ], projectRoot);
    if (gate.status !== 0) throw new Error(`Sealed workstation gate failed before network capture: ${gate.stderr || gate.stdout}`);
    const gateReport = JSON.parse(gate.stdout);
    if (gateReport.ok !== true ||
        gateReport.networkRequestsPerformed !== false ||
        gateReport.walletSigningAuthorized !== false ||
        gateReport.transactionSubmissionAuthorized !== false ||
        gateReport.supportClaimAuthorized !== false) {
      throw new Error('Sealed workstation gate attempted to weaken the evaluation-only authority boundary.');
    }

    process.stderr.write('Live capture stage 2/4: acquiring stable independently-confirmed Preprod protocol context...\n');
    client = createCardanoOgmiosHttpClient({
      url: ogmiosUrl,
      apiKey: ogmiosApiKey,
      apiKeyHeader: ogmiosApiKeyHeader
    });

    const live = await captureStableProtocolContext(client, blockfrostProjectId, retries);
    process.stderr.write(`Stable Preprod context acquired at slot ${live.snapshot.tip.slot}.\n`);
    await mkdir(campaign, { recursive: true });
    await writeFile(join(campaign, 'workstation-gate-receipt.json'), `${JSON.stringify(gateReport, null, 2)}\n`);
    const protocolPath = join(campaign, 'current-preprod-protocol-parameters.json');
    await writeFile(protocolPath, `${JSON.stringify(live.snapshot, null, 2)}\n`);

    process.stderr.write('Live capture stage 3/4: creating fresh campaign evidence directory and fixtures...\n');
    const prepared = runNode([
      'scripts/prepare-cardano-preprod-campaign.js',
      '--output', campaign,
      '--protocol-parameters', protocolPath,
      '--evaluation-slot', String(live.snapshot.tip.slot)
    ], projectRoot);
    if (prepared.status !== 0) throw new Error(`Campaign preparation failed: ${prepared.stderr || prepared.stdout}`);
    const preparation = JSON.parse(prepared.stdout);

    const campaignManifest = JSON.parse(await readFile(join(campaign, 'campaign-manifest.json'), 'utf8'));
    const captured = [];

    process.stderr.write('Live capture stage 4/4: evaluating initialize -> heartbeat -> approve -> execute against Preprod...\n');
    for (const entry of campaignManifest.sessions) {
      process.stderr.write(`Evaluating ${entry.action}...\n`);
      const session = resolve(campaign, entry.directory);
      const manifest = JSON.parse(await readFile(join(session, 'capture-manifest.json'), 'utf8'));
      const request = JSON.parse(await readFile(join(session, manifest.files.evaluationRequest), 'utf8'));
      let stable;
      try {
        stable = await evaluateAtStableTip({
          client,
          request,
          blockfrostProjectId,
          retries
        });
      } catch (error) {
        const diagnosticDirectory = join(campaign, 'diagnostics');
        await mkdir(diagnosticDirectory, { recursive: true });
        const diagnostic = {
          schema: 'omegavault.cardano.preprod-evaluation-failure.v1',
          network: 'preprod',
          action: entry.action,
          requestId: request.id ?? null,
          method: request.method ?? null,
          ogmios: error?.ogmios ?? null,
          message: error?.message ?? String(error),
          walletSigningPerformed: false,
          transactionSubmissionPerformed: false,
          supportClaimAuthorized: false
        };
        await writeFile(
          join(diagnosticDirectory, `${entry.action}-evaluation-failure.json`),
          `${JSON.stringify(diagnostic, null, 2)}\n`
        );
        throw new Error(`${entry.action} evaluation failed: ${error.message}`);
      }

      if (stable.epoch !== live.snapshot.tip.epoch) {
        throw new Error(`Preprod epoch changed during campaign capture (${live.snapshot.tip.epoch} -> ${stable.epoch}); restart with a new campaign directory.`);
      }

      const perSessionProtocol = stable.snapshot;

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
      process.stderr.write(`Evaluation ${entry.action}: verified and captured.\n`);
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

    client?.close?.();

    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-live-evaluation-campaign.v1',
      ok: true,
      network: 'preprod',
      campaign,
      campaignSha256: preparation.campaignSha256,
      invariantProgramSha256: preparation.invariantProgramSha256,
      sealedCheckpointRef: gateReport.checkpointRef,
      sealedCheckpointArchiveSha256: gateReport.checkpointArchiveSha256,
      sealedSourceTreeSha256: gateReport.sealedSourceTreeSha256,
      toolingSourceTreeSha256: gateReport.toolingSourceTreeSha256,
      independentlyConfirmedProtocolSources: 2,
      campaignProtocolTipHash: live.snapshot.tip.blockHash,
      campaignEvaluationSlot: live.snapshot.tip.slot,
      protocolContextAttempt: live.attempt,
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
    client?.close?.();
    process.stderr.write(`Cardano Preprod live evaluation campaign blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
