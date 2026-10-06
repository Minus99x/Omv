import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createCardanoOgmiosHttpClient,
  parseCardanoOgmiosTipResponse,
  parseCardanoOgmiosUtxoResponse
} from '../src/chains/cardano/preprod-live-capture.js';
import {
  createCardanoPreprodRealUtxoBindingEvidence,
  verifyCardanoPreprodRealUtxoBindingPlan
} from '../src/chains/cardano/preprod-real-utxo-binding.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const planArg = arg('--plan');
const outputArg = arg('--output');
const ogmiosUrl = arg('--ogmios-url', process.env.OMEGAVAULT_OGMIOS_URL ?? null);
const ogmiosApiKey = arg('--ogmios-api-key', process.env.OMEGAVAULT_OGMIOS_API_KEY ?? null);
const ogmiosApiKeyHeader = arg('--ogmios-api-key-header', process.env.OMEGAVAULT_OGMIOS_API_KEY_HEADER ?? 'dmtr-api-key');
const retries = Number(arg('--stable-tip-retries', '8'));

if (!planArg || !outputArg) {
  process.stderr.write('Real Cardano Preprod UTxO capture requires --plan and --output.\n');
  process.exitCode = 2;
} else if (!ogmiosUrl) {
  process.stderr.write('Set OMEGAVAULT_OGMIOS_URL (or --ogmios-url) to a Cardano Preprod Ogmios endpoint.\n');
  process.exitCode = 2;
} else if (!Number.isInteger(retries) || retries < 1 || retries > 30) {
  process.stderr.write('--stable-tip-retries must be an integer from 1 through 30.\n');
  process.exitCode = 2;
} else {
  let client = null;
  try {
    const planPath = resolve(planArg);
    const outputPath = resolve(outputArg);
    if (!await exists(planPath)) throw new Error('Real UTxO binding plan file does not exist.');
    if (await exists(outputPath)) throw new Error('Real UTxO binding evidence output already exists; refusing to overwrite append-only evidence.');

    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    const planCheck = verifyCardanoPreprodRealUtxoBindingPlan(plan);
    if (!planCheck.valid) throw new Error(`Real UTxO binding plan verification failed: ${planCheck.errors.join('; ')}`);

    client = createCardanoOgmiosHttpClient({
      url: ogmiosUrl,
      apiKey: ogmiosApiKey,
      apiKeyHeader: ogmiosApiKeyHeader
    });

    let evidence = null;
    let captureAttempt = null;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const tipBefore = parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
      const response = await client.rpc('queryLedgerState/utxo', plan.query.params);
      const queriedUtxo = parseCardanoOgmiosUtxoResponse(response);
      const tipAfter = parseCardanoOgmiosTipResponse(await client.rpc('queryNetwork/tip'));
      if (tipBefore.hash !== tipAfter.hash || tipBefore.slot !== tipAfter.slot) continue;

      evidence = createCardanoPreprodRealUtxoBindingEvidence({
        plan,
        tipBefore,
        tipAfter,
        queriedUtxo
      });
      captureAttempt = attempt;
      break;
    }

    if (!evidence) {
      throw new Error(`Could not bracket the real UTxO query by one stable Preprod tip after ${retries} attempts.`);
    }

    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    client.close();
    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-real-utxo-capture-cli.v1',
      ok: true,
      action: evidence.action,
      output: outputPath,
      stableTip: evidence.stableTip,
      captureAttempt,
      evidenceSha256: evidence.evidenceSha256,
      realUtxoReferencesExist: true,
      fullPhaseOneValidated: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      hardStop: 'STOP. Real UTxO existence is proven only. Exact transaction reconstruction, complete phase-1 validation, wallet signing and submission remain separately gated.'
    }, null, 2)}\n`);
  } catch (error) {
    client?.close?.();
    process.stderr.write(`Cardano real Preprod UTxO capture blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
