import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  createCardanoOgmiosHttpClient,
  createCardanoOgmiosUtxoByOutputReferencesParams,
  fetchCardanoBlockfrostPreprodProtocolParameters,
  normalizeCardanoOgmiosWebSocketUrl,
  parseCardanoOgmiosBlockHeightResponse,
  parseCardanoOgmiosEpochResponse,
  parseCardanoOgmiosProtocolParametersResponse,
  parseCardanoOgmiosTipResponse,
  parseCardanoOgmiosUtxoResponse
} from '../src/chains/cardano/preprod-live-capture.js';
import { createCardanoPreprodLiveProtocolSnapshot } from '../src/chains/cardano/live-protocol-parameters.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import {
  createCardanoPreprodInitializePreSubmitEvidence,
  verifyCardanoPreprodInitializePreSubmitEvidence
} from '../src/chains/cardano/preprod-initialize-presubmit.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const captureArg = arg('--capture');
const witnessArg = arg('--witness-evidence');
const outputArg = arg('--output');
const ogmiosUrl = arg('--ogmios-url', process.env.OMEGAVAULT_OGMIOS_URL ?? null);
const ogmiosApiKey = arg('--ogmios-api-key', process.env.OMEGAVAULT_OGMIOS_API_KEY ?? null);
const ogmiosApiKeyHeader = arg('--ogmios-api-key-header', process.env.OMEGAVAULT_OGMIOS_API_KEY_HEADER ?? 'dmtr-api-key');
const blockfrostProjectId = arg('--blockfrost-project-id', process.env.BLOCKFROST_PROJECT_ID ?? null);
const retries = Number(arg('--stable-tip-retries', '8'));

if (!captureArg || !witnessArg || !outputArg) {
  process.stderr.write('Cardano initialize pre-submit check requires --capture, --witness-evidence and --output.\n');
  process.exitCode = 2;
} else if (!ogmiosUrl || !blockfrostProjectId) {
  process.stderr.write('Cardano initialize pre-submit check requires OMEGAVAULT_OGMIOS_URL and BLOCKFROST_PROJECT_ID provider credentials.\n');
  process.exitCode = 2;
} else if (!Number.isInteger(retries) || retries < 1 || retries > 30) {
  process.stderr.write('--stable-tip-retries must be an integer from 1 through 30.\n');
  process.exitCode = 2;
} else {
  let client = null;
  try {
    const capture = resolve(captureArg);
    const witnessPath = resolve(witnessArg);
    const output = resolve(outputArg);
    if (!await exists(capture)) throw new Error('Real initialize capture directory does not exist.');
    if (!await exists(witnessPath)) throw new Error('Wallet witness evidence file does not exist.');
    if (await exists(output)) throw new Error('Pre-submit evidence output already exists; refusing to overwrite append-only evidence.');

    const manifest = await readJson(join(capture, 'capture-manifest.json'));
    if (manifest.schema !== 'omegavault.cardano.preprod-real-initialize-capture-manifest.v1') {
      throw new Error('Real initialize capture manifest schema is not supported.');
    }

    const appliedValidatorIdentity = await readJson(join(capture, manifest.files.appliedValidatorIdentity));
    const utxoBindingEvidence = await readJson(join(capture, manifest.files.utxoBindingEvidence));
    const unsignedCandidate = await readJson(join(capture, manifest.files.finalUnsignedCandidate));
    const unsignedPreflight = await readJson(join(capture, manifest.files.unsignedPhaseOnePreflight));
    const witnessEvidence = await readJson(witnessPath);
    const signedTransactionCborHex = witnessEvidence.signedTransactionCborHex;
    const recoveryConfig = {
      rescueKeyHash: unsignedCandidate.recoveryConfiguration?.rescueKeyHash,
      contactKeyHashes: unsignedCandidate.recoveryConfiguration?.contactKeyHashes,
      threshold: unsignedCandidate.recoveryConfiguration?.threshold,
      inactivityMs: unsignedCandidate.recoveryConfiguration?.inactivityMs,
      stateLovelace: unsignedCandidate.recoveryConfiguration?.stateLovelace
    };

    client = createCardanoOgmiosHttpClient({
      url: normalizeCardanoOgmiosWebSocketUrl(ogmiosUrl),
      apiKey: ogmiosApiKey,
      apiKeyHeader: ogmiosApiKeyHeader
    });

    let evidence = null;
    let attemptUsed = null;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const tipBefore = parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
      const currentQueriedUtxo = parseCardanoOgmiosUtxoResponse(
        await client.rpc(
          'queryLedgerState/utxo',
          createCardanoOgmiosUtxoByOutputReferencesParams([
            utxoBindingEvidence.roles.seed.reference,
            utxoBindingEvidence.roles.collateral.reference
          ])
        )
      );
      const epoch = parseCardanoOgmiosEpochResponse(await client.rpc('queryLedgerState/epoch'));
      const blockHeight = parseCardanoOgmiosBlockHeightResponse(await client.rpc('queryNetwork/blockHeight'));
      const ogmiosParameters = parseCardanoOgmiosProtocolParametersResponse(
        await client.rpc('queryLedgerState/protocolParameters')
      );
      const blockfrostParameters = await fetchCardanoBlockfrostPreprodProtocolParameters({
        projectId: blockfrostProjectId
      });
      const tipAfter = parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
      if (tipBefore.hash !== tipAfter.hash || tipBefore.slot !== tipAfter.slot) continue;

      const currentSnapshot = createCardanoPreprodLiveProtocolSnapshot({
        ogmiosParameters,
        blockfrostParameters,
        epoch,
        tip: tipBefore,
        blockHeight
      });
      const currentParameters = normalizeCardanoProtocolParameterSnapshot(currentSnapshot);
      evidence = createCardanoPreprodInitializePreSubmitEvidence({
        witnessEvidence,
        signedTransactionCborHex,
        unsignedCandidate,
        unsignedPreflight,
        appliedValidatorIdentity,
        utxoBindingEvidence,
        currentProtocolSnapshot: currentSnapshot,
        currentParameters,
        recoveryConfig,
        currentTip: tipBefore,
        currentQueriedUtxo
      });
      const verified = verifyCardanoPreprodInitializePreSubmitEvidence({
        evidence,
        witnessEvidence,
        signedTransactionCborHex,
        unsignedCandidate,
        unsignedPreflight,
        appliedValidatorIdentity,
        utxoBindingEvidence,
        currentProtocolSnapshot: currentSnapshot,
        currentParameters,
        recoveryConfig,
        currentTip: tipBefore,
        currentQueriedUtxo
      });
      if (!verified.valid) throw new Error(`Pre-submit evidence failed reproduction: ${verified.errors.join('; ')}`);
      attemptUsed = attempt;
      break;
    }

    if (!evidence) throw new Error(`Could not bracket the initialize pre-submit checks by one stable Preprod tip after ${retries} attempts.`);
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
    client.close();

    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-initialize-pre-submit-cli.v1',
      ok: true,
      output,
      attempt: attemptUsed,
      currentTip: evidence.currentTip,
      preSubmitSha256: evidence.preSubmitSha256,
      seedStillUnspent: evidence.checks.seedStillUnspent,
      collateralStillUnspent: evidence.checks.collateralStillUnspent,
      validityIntervalCurrent: evidence.checks.validityIntervalCurrent,
      completePhaseOneValidated: false,
      transactionSubmissionPerformed: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      hardStop: 'STOP. Freshness checks passed only. Complete phase-1 ledger validation and explicit human authorization are still required before any submission.'
    }, null, 2)}\n`);
  } catch (error) {
    client?.close?.();
    process.stderr.write(`Cardano initialize pre-submit check blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
