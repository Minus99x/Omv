import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCardanoPreprodRealUtxoBindingPlan } from '../src/chains/cardano/preprod-real-utxo-binding.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function parseReference(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} is required as <txid>#<index>.`);
  const match = /^([0-9a-fA-F]{64})#(\d+)$/.exec(value.trim());
  if (!match) throw new TypeError(`${label} must be <64-hex-txid>#<non-negative-index>.`);
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index)) throw new TypeError(`${label} index exceeds the safe integer range.`);
  return Object.freeze({
    transaction: Object.freeze({ id: match[1].toLowerCase() }),
    index
  });
}

const action = arg('--action');
const identityArg = arg('--identity');
const outputArg = arg('--output');

if (!action || !identityArg || !outputArg) {
  process.stderr.write('Prepare real Cardano Preprod UTxO binding with --action, --identity and --output.\n');
  process.exitCode = 2;
} else {
  try {
    const identityPath = resolve(identityArg);
    const outputPath = resolve(outputArg);
    if (!await exists(identityPath)) throw new Error('Applied validator identity file does not exist.');
    if (await exists(outputPath)) throw new Error('Real UTxO binding plan output already exists; refusing to overwrite append-only evidence.');

    const appliedValidatorIdentity = JSON.parse(await readFile(identityPath, 'utf8'));
    const roles = action === 'initialize'
      ? {
          seed: parseReference(arg('--seed'), '--seed'),
          fee: parseReference(arg('--fee'), '--fee'),
          collateral: parseReference(arg('--collateral'), '--collateral')
        }
      : {
          state: parseReference(arg('--state'), '--state'),
          fee: parseReference(arg('--fee'), '--fee'),
          collateral: parseReference(arg('--collateral'), '--collateral')
        };

    const plan = createCardanoPreprodRealUtxoBindingPlan({
      action,
      roles,
      appliedValidatorIdentity
    });
    await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-real-utxo-plan-cli.v1',
      ok: true,
      action: plan.action,
      output: outputPath,
      validatorIdentitySha256: plan.validatorIdentity.identitySha256,
      planSha256: plan.planSha256,
      networkRequestsPerformed: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      next: 'Capture these exact output references from Cardano Preprod at one stable Ogmios tip.'
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano real Preprod UTxO plan blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
