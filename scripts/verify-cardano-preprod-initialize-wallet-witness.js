import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import {
  createCardanoPreprodInitializeWalletWitnessEvidence,
  verifyCardanoPreprodInitializeWalletWitnessEvidence
} from '../src/chains/cardano/preprod-initialize-wallet-witness.js';

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

async function readSignedTransaction(path) {
  const raw = (await readFile(path, 'utf8')).trim();
  if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) return raw;
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error('Signed transaction file must contain raw transaction CBOR hex or JSON with cborHex/transactionCborHex.');
  }
  const value = parsed?.cborHex ?? parsed?.transactionCborHex ?? parsed?.signedTransactionCborHex;
  if (typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error('Signed transaction JSON does not contain valid cborHex/transactionCborHex/signedTransactionCborHex.');
  }
  return value.toLowerCase();
}

const captureArg = arg('--capture');
const signedTxArg = arg('--signed-tx');
const outputArg = arg('--output');

if (!captureArg || !signedTxArg || !outputArg) {
  process.stderr.write('Verify Cardano initialize wallet witness with --capture, --signed-tx and --output.\n');
  process.exitCode = 2;
} else {
  try {
    const capture = resolve(captureArg);
    const signedTxPath = resolve(signedTxArg);
    const output = resolve(outputArg);
    if (!await exists(capture)) throw new Error('Real initialize capture directory does not exist.');
    if (!await exists(signedTxPath)) throw new Error('Signed transaction file does not exist.');
    if (await exists(output)) throw new Error('Wallet witness evidence output already exists; refusing to overwrite append-only evidence.');

    const manifestPath = join(capture, 'capture-manifest.json');
    if (!await exists(manifestPath)) throw new Error('Real initialize capture manifest is missing.');
    const manifest = await readJson(manifestPath);
    if (manifest.schema !== 'omegavault.cardano.preprod-real-initialize-capture-manifest.v1' ||
        manifest.network !== 'preprod' ||
        manifest.synchronizedRealInitializeEvaluationComplete !== true ||
        manifest.fullPhaseOneValidated !== false ||
        manifest.walletSigningAuthorized !== false ||
        manifest.transactionSubmissionAuthorized !== false ||
        manifest.supportClaimAuthorized !== false) {
      throw new Error('Real initialize capture manifest is not in the expected fail-closed pre-signing state.');
    }
    const manifestCore = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'manifestSha256'));
    if (hashCardanoEvidence(manifestCore) !== manifest.manifestSha256) {
      throw new Error('Real initialize capture manifest self-digest mismatch.');
    }

    const requiredFiles = [
      'appliedValidatorIdentity',
      'utxoBindingEvidence',
      'protocolSnapshot',
      'finalUnsignedCandidate',
      'unsignedPhaseOnePreflight'
    ];
    for (const key of requiredFiles) {
      if (typeof manifest.files?.[key] !== 'string' || !manifest.files[key]) {
        throw new Error(`Real initialize capture manifest is missing file mapping: ${key}.`);
      }
    }

    const appliedValidatorIdentity = await readJson(join(capture, manifest.files.appliedValidatorIdentity));
    const utxoBindingEvidence = await readJson(join(capture, manifest.files.utxoBindingEvidence));
    const protocolSnapshot = await readJson(join(capture, manifest.files.protocolSnapshot));
    const unsignedCandidate = await readJson(join(capture, manifest.files.finalUnsignedCandidate));
    const unsignedPreflight = await readJson(join(capture, manifest.files.unsignedPhaseOnePreflight));

    if (manifest.identities?.validatorIdentitySha256 !== appliedValidatorIdentity.identitySha256) {
      throw new Error('Capture manifest validator identity does not match the applied-validator artifact.');
    }
    if (manifest.identities?.utxoBindingEvidenceSha256 !== utxoBindingEvidence.evidenceSha256) {
      throw new Error('Capture manifest UTxO binding identity does not match the binding-evidence artifact.');
    }
    if (manifest.identities?.finalUnsignedCandidateSha256 !== unsignedCandidate.candidateSha256) {
      throw new Error('Capture manifest final unsigned candidate identity does not match the candidate artifact.');
    }
    if (manifest.identities?.unsignedPhaseOnePreflightSha256 !== unsignedPreflight.preflightSha256) {
      throw new Error('Capture manifest unsigned preflight identity does not match the preflight artifact.');
    }

    const parameters = normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);
    const recoveryConfig = {
      rescueKeyHash: unsignedCandidate.recoveryConfiguration?.rescueKeyHash,
      contactKeyHashes: unsignedCandidate.recoveryConfiguration?.contactKeyHashes,
      threshold: unsignedCandidate.recoveryConfiguration?.threshold,
      inactivityMs: unsignedCandidate.recoveryConfiguration?.inactivityMs,
      stateLovelace: unsignedCandidate.recoveryConfiguration?.stateLovelace
    };
    const signedTransactionCborHex = await readSignedTransaction(signedTxPath);

    const evidence = createCardanoPreprodInitializeWalletWitnessEvidence({
      signedTransactionCborHex,
      unsignedCandidate,
      unsignedPreflight,
      appliedValidatorIdentity,
      utxoBindingEvidence,
      parameters,
      recoveryConfig
    });
    const verified = verifyCardanoPreprodInitializeWalletWitnessEvidence({
      evidence,
      signedTransactionCborHex,
      unsignedCandidate,
      unsignedPreflight,
      appliedValidatorIdentity,
      utxoBindingEvidence,
      parameters,
      recoveryConfig
    });
    if (!verified.valid) {
      throw new Error(`Wallet witness evidence failed reproduction: ${verified.errors.join('; ')}`);
    }

    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-initialize-wallet-witness-cli.v1',
      ok: true,
      output,
      witnessEvidenceSha256: evidence.witnessEvidenceSha256,
      transactionBodyHash: evidence.transactionBodyHash,
      ownerPaymentKeyHash: evidence.ownerPaymentKeyHash,
      witnessCount: evidence.witnessCount,
      walletWitnessesValidated: true,
      completePhaseOneValidated: false,
      transactionSubmissionPerformed: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      hardStop: 'STOP. The wallet witness is verified, but complete current-ledger phase-1 validation and explicit submission authorization remain separately required.'
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano initialize wallet witness verification blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
