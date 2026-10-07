import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { createCardanoOgmiosHttpClient } from '../src/chains/cardano/preprod-live-capture.js';
import { captureCardanoPreprodRealInitializeEvaluation } from '../src/chains/cardano/preprod-real-initialize-live.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const walletAddress = arg('--wallet-address');
const recoveryConfigArg = arg('--recovery-config');
const outputArg = arg('--output');
const assetNameHex = arg('--asset-name-hex', '4f56');
const retries = Number(arg('--stable-tip-retries', '8'));
const ogmiosUrl = arg('--ogmios-url', process.env.OMEGAVAULT_OGMIOS_URL ?? null);
const ogmiosApiKey = arg('--ogmios-api-key', process.env.OMEGAVAULT_OGMIOS_API_KEY ?? null);
const ogmiosApiKeyHeader = arg('--ogmios-api-key-header', process.env.OMEGAVAULT_OGMIOS_API_KEY_HEADER ?? 'dmtr-api-key');
const blockfrostProjectId = arg('--blockfrost-project-id', process.env.BLOCKFROST_PROJECT_ID ?? null);

if (!walletAddress || !recoveryConfigArg || !outputArg) {
  process.stderr.write('Real Cardano initialize capture requires --wallet-address, --recovery-config and --output.\n');
  process.exitCode = 2;
} else if (!ogmiosUrl || !blockfrostProjectId) {
  process.stderr.write('Real Cardano initialize capture requires OMEGAVAULT_OGMIOS_URL and BLOCKFROST_PROJECT_ID provider credentials.\n');
  process.exitCode = 2;
} else if (!Number.isInteger(retries) || retries < 1 || retries > 30) {
  process.stderr.write('--stable-tip-retries must be an integer from 1 through 30.\n');
  process.exitCode = 2;
} else {
  let client = null;
  let temp = null;
  try {
    const output = resolve(outputArg);
    const recoveryConfigPath = resolve(recoveryConfigArg);
    if (await exists(output)) throw new Error('Real initialize capture output already exists; refusing to overwrite append-only evidence.');
    if (!await exists(recoveryConfigPath)) throw new Error('Recovery configuration file does not exist.');
    const recoveryConfig = JSON.parse(await readFile(recoveryConfigPath, 'utf8'));

    temp = await mkdtemp(join(tmpdir(), 'omegavault-cardano-real-init-'));
    const deriveAppliedValidatorIdentity = async ({ seedReference, assetNameHex: selectedAssetNameHex }) => {
      const identityPath = join(temp, `identity-${seedReference.transaction.id}-${seedReference.index}.json`);
      const result = execFileSync(process.execPath, [
        'scripts/derive-cardano-preprod-live-validators.js',
        '--seed-tx-id', seedReference.transaction.id,
        '--seed-index', String(seedReference.index),
        '--asset-name-hex', selectedAssetNameHex,
        '--output', identityPath
      ], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const reported = JSON.parse(result);
      if (reported.networkRequestsPerformed !== false ||
          reported.walletSigningPerformed !== false ||
          reported.transactionSubmissionPerformed !== false) {
        throw new Error('Applied validator derivation attempted to cross its offline authority boundary.');
      }
      return JSON.parse(await readFile(identityPath, 'utf8'));
    };

    client = createCardanoOgmiosHttpClient({
      url: ogmiosUrl,
      apiKey: ogmiosApiKey,
      apiKeyHeader: ogmiosApiKeyHeader
    });

    process.stderr.write('Real Cardano initialize: discovering plain ADA-only Preprod UTxOs and deriving the exact one-shot validator identity...\n');
    const capture = await captureCardanoPreprodRealInitializeEvaluation({
      walletAddress,
      blockfrostProjectId,
      client,
      deriveAppliedValidatorIdentity,
      recoveryConfig,
      assetNameHex,
      stableTipRetries: retries
    });

    const artifactMap = Object.freeze({
      appliedValidatorIdentity: 'applied-validator-identity.json',
      utxoBindingPlan: 'utxo-binding-plan.json',
      utxoBindingEvidence: 'utxo-binding-evidence.json',
      protocolSnapshot: 'current-preprod-protocol-parameters.json',
      evaluationCandidate: 'initialize-evaluation-candidate.json',
      evaluationEvidence: 'initialize-evaluation-evidence.json',
      finalUnsignedCandidate: 'initialize-final-unsigned-candidate.json',
      unsignedPhaseOnePreflight: 'initialize-unsigned-phase-one-preflight.json'
    });

    const manifestCore = Object.freeze({
      schema: 'omegavault.cardano.preprod-real-initialize-capture-manifest.v1',
      network: 'preprod',
      walletAddress,
      attempt: capture.attempt,
      files: artifactMap,
      identities: Object.freeze({
        validatorIdentitySha256: capture.appliedValidatorIdentity.identitySha256,
        utxoBindingPlanSha256: capture.bindingPlan.planSha256,
        utxoBindingEvidenceSha256: capture.utxoBindingEvidence.evidenceSha256,
        evaluationCandidateSha256: capture.evaluationCandidate.candidateSha256,
        evaluationEvidenceSha256: capture.evaluationEvidence.evidenceSha256,
        finalUnsignedCandidateSha256: capture.finalUnsignedCandidate.candidateSha256,
        unsignedPhaseOnePreflightSha256: capture.unsignedPhaseOnePreflight.preflightSha256
      }),
      selected: capture.selected,
      synchronizedRealInitializeEvaluationComplete: true,
      fullPhaseOneValidated: false,
      walletSigningPerformed: false,
      transactionSubmissionPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false,
      supportClaimAuthorized: false,
      nextGate: 'unsigned-phase-one-preflight-then-wallet-witness-policy',
      authorityBoundary: 'This capture ends with an unsigned budget-applied initialize candidate. It does not authorize wallet signing or transaction submission and does not claim complete phase-1 validation, finality, recovery or Cardano support.'
    });
    const manifest = Object.freeze({
      ...manifestCore,
      manifestSha256: hashCardanoEvidence(manifestCore)
    });

    await mkdir(output, { recursive: false });
    const writes = [
      [artifactMap.appliedValidatorIdentity, capture.appliedValidatorIdentity],
      [artifactMap.utxoBindingPlan, capture.bindingPlan],
      [artifactMap.utxoBindingEvidence, capture.utxoBindingEvidence],
      [artifactMap.protocolSnapshot, capture.protocolSnapshot],
      [artifactMap.evaluationCandidate, capture.evaluationCandidate],
      [artifactMap.evaluationEvidence, capture.evaluationEvidence],
      [artifactMap.finalUnsignedCandidate, capture.finalUnsignedCandidate],
      [artifactMap.unsignedPhaseOnePreflight, capture.unsignedPhaseOnePreflight],
      ['capture-manifest.json', manifest]
    ];
    for (const [name, value] of writes) {
      await writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`);
    }

    client.close();
    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-real-initialize-capture-cli.v1',
      ok: true,
      output,
      stableTip: capture.utxoBindingEvidence.stableTip,
      validatorIdentitySha256: capture.appliedValidatorIdentity.identitySha256,
      evaluationEvidenceSha256: capture.evaluationEvidence.evidenceSha256,
      finalUnsignedCandidateSha256: capture.finalUnsignedCandidate.candidateSha256,
      unsignedPhaseOnePreflightSha256: capture.unsignedPhaseOnePreflight.preflightSha256,
      manifestSha256: manifest.manifestSha256,
      synchronizedRealInitializeEvaluationComplete: true,
      fullPhaseOneValidated: false,
      walletSigningPerformed: false,
      transactionSubmissionPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      hardStop: 'STOP. The real initialize candidate is still unsigned. Complete the separate unsigned phase-one/wallet-witness gate before any signing or submission.'
    }, null, 2)}\n`);
  } catch (error) {
    client?.close?.();
    process.stderr.write(`Cardano real Preprod initialize capture blocked: ${error.message}\n`);
    process.exitCode = 2;
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}
