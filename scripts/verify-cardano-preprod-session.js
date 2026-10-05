import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  evaluateCardanoPreprodCaptureSession,
  verifyCardanoPreprodCaptureSessionManifest
} from '../src/chains/cardano/preprod-capture-session.js';

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

const session = resolve(arg('--session', 'cardano-preprod-session'));
const manifestPath = join(session, 'capture-manifest.json');
if (!await exists(manifestPath)) {
  process.stderr.write('Cardano Preprod capture manifest is missing. Run cardano:preprod:prepare first.\n');
  process.exitCode = 2;
} else {
  try {
    const manifest = await readJson(manifestPath);
    const manifestCheck = verifyCardanoPreprodCaptureSessionManifest(manifest);
    if (!manifestCheck.valid) throw new Error(manifestCheck.errors.join('; '));

    const required = ['acquiredTip', 'utxoSnapshot', 'protocolParameters', 'ogmiosEvaluation', 'phaseOneValidation'];
    const missing = [];
    for (const key of required) {
      const path = join(session, manifest.files[key]);
      if (!await exists(path)) missing.push(manifest.files[key]);
    }
    if (missing.length > 0) {
      process.stdout.write(`${JSON.stringify({
        schema: 'omegavault.cardano.preprod-session-status.v1',
        ok: false,
        state: 'capture-incomplete',
        session,
        checkpointVerified: true,
        manifestSha256: manifest.manifestSha256,
        invariantProgramSha256: manifest.invariantProgram.programSha256,
        supportClaimAuthorized: false,
        missing,
        networkRequestsPerformed: false,
        walletSigningAuthorized: false,
        transactionSubmissionAuthorized: false
      }, null, 2)}\n`);
      process.exitCode = 2;
    } else {
      const result = evaluateCardanoPreprodCaptureSession({
        manifest,
        acquiredTip: await readJson(join(session, manifest.files.acquiredTip)),
        utxoSnapshot: await readJson(join(session, manifest.files.utxoSnapshot)),
        protocolParameterSnapshot: await readJson(join(session, manifest.files.protocolParameters)),
        ogmiosEvaluation: await readJson(join(session, manifest.files.ogmiosEvaluation)),
        phaseOneValidation: await readJson(join(session, manifest.files.phaseOneValidation))
      });
      const evidencePath = join(session, manifest.files.evidence);
      await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({
        schema: 'omegavault.cardano.preprod-session-status.v1',
        ok: true,
        state: 'synchronized-evaluation-evidence-ready',
        session,
        evidencePath,
        resultSha256: result.resultSha256,
        evidenceSha256: result.evidence.evidenceSha256,
        invariantProgramSha256: result.invariantEvidenceStatus.programSha256,
        invariantLifecycleProgramComplete: result.invariantEvidenceStatus.lifecycleProgramComplete,
        supportClaimAuthorized: result.invariantEvidenceStatus.supportClaimAuthorized,
        independentProtocolParameterSources: result.protocolParameterGate.independentSourceCount,
        networkRequestsPerformed: false,
        walletSigningAuthorized: false,
        transactionSubmissionAuthorized: false,
        publicNetworkRecoveryProven: false
      }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`Cardano Preprod capture verification failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}
