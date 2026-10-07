import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createCardanoPreprodRecoveryConfiguration,
  verifyCardanoPreprodRecoveryConfiguration
} from '../src/chains/cardano/preprod-recovery-config.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const rescueAddress = arg('--rescue-address');
const contactsArg = arg('--contact-addresses');
const threshold = Number(arg('--threshold'));
const inactivityMs = Number(arg('--inactivity-ms'));
const stateLovelace = arg('--state-lovelace', '10000000');
const outputArg = arg('--output');

if (!rescueAddress || !contactsArg || !outputArg || !Number.isInteger(threshold) || !Number.isSafeInteger(inactivityMs)) {
  process.stderr.write('Prepare Cardano Preprod recovery configuration with --rescue-address, --contact-addresses <comma-separated>, --threshold, --inactivity-ms and --output.\n');
  process.exitCode = 2;
} else {
  try {
    const output = resolve(outputArg);
    if (await exists(output)) throw new Error('Recovery configuration output already exists; refusing to overwrite append-only configuration evidence.');
    const contactAddresses = contactsArg.split(',').map(value => value.trim()).filter(Boolean);
    const configuration = createCardanoPreprodRecoveryConfiguration({
      rescueAddress: rescueAddress.trim(),
      contactAddresses,
      threshold,
      inactivityMs,
      stateLovelace
    });
    const verified = verifyCardanoPreprodRecoveryConfiguration(configuration);
    if (!verified.valid) throw new Error(`Recovery configuration failed self-verification: ${verified.errors.join('; ')}`);
    await writeFile(output, `${JSON.stringify(configuration, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      schema: 'omegavault.cardano.preprod-recovery-configuration-cli.v1',
      ok: true,
      output,
      rescueAddress: configuration.rescueAddress,
      contactCount: configuration.contactAddresses.length,
      threshold: configuration.threshold,
      inactivityMs: configuration.inactivityMs,
      stateLovelace: configuration.stateLovelace,
      configurationSha256: configuration.configurationSha256,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false,
      next: 'Use this immutable configuration as the recovery-policy input for the real Cardano Preprod initialize capture.'
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Cardano Preprod recovery configuration blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
