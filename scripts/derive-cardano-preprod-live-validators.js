import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCardanoPreprodAppliedValidatorIdentity,
  encodeCardanoAssetNamePlutusData,
  encodeCardanoOutputReferencePlutusData
} from '../src/chains/cardano/live-validator-identity.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cardanoDir = join(root, 'validators', 'cardano');
const aikenRunner = join(root, 'node_modules', '@aiken-lang', 'aiken', 'run-aiken.js');
const blueprintPath = join(cardanoDir, 'plutus.json');

const seedTxId = String(arg('--seed-tx-id', '')).toLowerCase();
const seedIndex = Number(arg('--seed-index', '0'));
const assetNameHex = String(arg('--asset-name-hex', '4f56')).toLowerCase();
const outputArg = arg('--output');

if (!/^[0-9a-f]{64}$/.test(seedTxId)) {
  process.stderr.write('--seed-tx-id must be a 32-byte transaction id in base16.\n');
  process.exitCode = 2;
} else if (!Number.isSafeInteger(seedIndex) || seedIndex < 0) {
  process.stderr.write('--seed-index must be a non-negative safe integer.\n');
  process.exitCode = 2;
} else if (!/^[0-9a-f]*$/.test(assetNameHex) || assetNameHex.length % 2 !== 0 || assetNameHex.length > 64) {
  process.stderr.write('--asset-name-hex must be 0-32 bytes of base16.\n');
  process.exitCode = 2;
} else {
  const outputPath = outputArg ? resolve(outputArg) : null;
  let work = null;
  try {
    if (outputPath && await exists(outputPath)) {
      throw new Error('Applied validator identity output already exists; refusing to overwrite append-only deployment evidence.');
    }

    const sourceBlueprint = await readFile(blueprintPath);
    const sourceBlueprintSha256 = createHash('sha256').update(sourceBlueprint).digest('hex');
    const seedReference = { transaction: { id: seedTxId }, index: seedIndex };
    const seedData = encodeCardanoOutputReferencePlutusData(seedReference);
    const assetData = encodeCardanoAssetNamePlutusData(assetNameHex);

    work = await mkdtemp(join(tmpdir(), 'omegavault-cardano-live-applied-'));
    const beaconStep = join(work, 'beacon-step.json');
    const beaconApplied = join(work, 'beacon-applied.json');
    const vaultStep = join(work, 'vault-step.json');
    const vaultApplied = join(work, 'vault-applied.json');

    const run = args => execFileSync(process.execPath, [aikenRunner, ...args], {
      cwd: cardanoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();

    run(['blueprint', 'apply', '-m', 'omegavault', '-v', 'state_beacon', seedData, '-i', 'plutus.json', '-o', beaconStep]);
    run(['blueprint', 'apply', '-m', 'omegavault', '-v', 'state_beacon', assetData, '-i', beaconStep, '-o', beaconApplied]);
    const policyId = run(['blueprint', 'policy', '-m', 'omegavault', '-v', 'state_beacon', '-i', beaconApplied]);

    run(['blueprint', 'apply', '-m', 'omegavault', '-v', 'recovery_vault', `581c${policyId}`, '-i', 'plutus.json', '-o', vaultStep]);
    run(['blueprint', 'apply', '-m', 'omegavault', '-v', 'recovery_vault', assetData, '-i', vaultStep, '-o', vaultApplied]);
    const recoveryHash = run(['blueprint', 'hash', '-m', 'omegavault', '-v', 'recovery_vault', '-i', vaultApplied]);
    const recoveryAddress = run(['blueprint', 'address', '-m', 'omegavault', '-v', 'recovery_vault', '-i', vaultApplied]);

    const beaconBlueprint = JSON.parse(await readFile(beaconApplied, 'utf8'));
    const vaultBlueprint = JSON.parse(await readFile(vaultApplied, 'utf8'));
    const beaconCompiledCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint')?.compiledCode;
    const recoveryCompiledCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend')?.compiledCode;
    if (!beaconCompiledCode || !recoveryCompiledCode) throw new Error('Aiken applied blueprints did not contain the expected OmegaVault validators.');

    const identity = createCardanoPreprodAppliedValidatorIdentity({
      seedReference,
      assetNameHex,
      sourceBlueprintSha256,
      beaconCompiledCode,
      recoveryCompiledCode,
      aikenPolicyId: policyId,
      aikenRecoveryHash: recoveryHash,
      aikenRecoveryAddress: recoveryAddress
    });

    const result = Object.freeze({
      ...identity,
      provenance: Object.freeze({
        aikenVersion: run(['--version']),
        sourceBlueprint: 'validators/cardano/plutus.json',
        beaconAppliedBlueprintSha256: createHash('sha256').update(await readFile(beaconApplied)).digest('hex'),
        recoveryAppliedBlueprintSha256: createHash('sha256').update(await readFile(vaultApplied)).digest('hex')
      })
    });

    if (outputPath) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      ...result,
      output: outputPath,
      networkRequestsPerformed: false,
      walletSigningPerformed: false,
      transactionSubmissionPerformed: false,
      hardStop: 'STOP. Applied validator identity is deterministic configuration only. The selected seed must still be proven as a live Preprod UTxO before constructing any real transaction.'
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano live validator identity derivation blocked: ${error.message}\n`);
    process.exitCode = 2;
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
  }
}
