import { readFile, writeFile } from 'node:fs/promises';
import { prepareCardanoPreprodInitializeValidationPackage, replayCardanoPreprodInitializeValidationPackage } from '../src/chains/cardano/preprod-initialize-validation-package.js';

// Offline only: no provider, wallet, signing, or submission capability.
const args = process.argv.slice(2);
try {
  if ((args.length !== 4 && !(args.length === 5 && args[4] === '--local-replay')) || args[0] !== '--input' || args[2] !== '--output' || !args[1] || !args[3]) {
    throw new Error('Usage: node scripts/prepare-cardano-preprod-initialize-validation-package.js --input inputs.json --output package.json [--local-replay]');
  }
  const inputs = JSON.parse(await readFile(args[1], 'utf8'));
  const replay = args[4] === '--local-replay';
  const result = replay ? await replayCardanoPreprodInitializeValidationPackage(inputs) : prepareCardanoPreprodInitializeValidationPackage(inputs);
  const prepared = replay ? result.validationPackage : result;
  // Exclusive creation preserves earlier receipts and prevents overwriting inputs.
  await writeFile(args[3], JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({
    packageSha256: prepared.packageSha256,
    replaySha256: result.replaySha256 ?? null,
    acceptedByEmulator: result.trial?.acceptedByEmulator ?? null,
    requestSha256: prepared.phaseOneInput.requestSha256,
    completePhaseOneValidated: false,
    transactionSubmissionAuthorized: false
  }) + '\n');
  if (replay && result.trial.acceptedByEmulator !== true) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`Initialize validation package preparation failed: ${error.message}\n`);
  process.exitCode = 1;
}
