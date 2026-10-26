import { readFile, writeFile } from 'node:fs/promises';
import { prepareCardanoPreprodInitializeValidationPackage } from '../src/chains/cardano/preprod-initialize-validation-package.js';

// Offline only: no provider, wallet, signing, or submission capability.
const args = process.argv.slice(2);
try {
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output' || !args[1] || !args[3]) {
    throw new Error('Usage: node scripts/prepare-cardano-preprod-initialize-validation-package.js --input inputs.json --output package.json');
  }
  const inputs = JSON.parse(await readFile(args[1], 'utf8'));
  const result = prepareCardanoPreprodInitializeValidationPackage(inputs);
  // Exclusive creation preserves earlier receipts and prevents overwriting inputs.
  await writeFile(args[3], JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({
    packageSha256: result.packageSha256,
    requestSha256: result.phaseOneInput.requestSha256,
    completePhaseOneValidated: false,
    transactionSubmissionAuthorized: false
  }) + '\n');
} catch (error) {
  process.stderr.write(`Initialize validation package preparation failed: ${error.message}\n`);
  process.exitCode = 1;
}
