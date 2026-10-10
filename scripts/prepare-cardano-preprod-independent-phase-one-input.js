import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createCardanoPreprodIndependentPhaseOneInput, verifyCardanoPreprodIndependentPhaseOneInput } from '../src/chains/cardano/preprod-independent-phase-one-input.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const signingPath = argument('--signing');
const preSubmitPath = argument('--presubmit');
const outputPath = argument('--output');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write([
    'OmegaVault Cardano Preprod independent phase-one ledger-validator input',
    'Requires --signing <wallet-signing-dir> --presubmit <pre-submit-evidence.json> --output <new-output.json>',
    'All inputs are existing local artifacts; no credentials, signing, or network access.',
    'Creates a byte-bound request for an independent ledger validator (NOT a phase-one validation verdict).',
    'A completed request never authorizes transaction submission.'
  ].join('\n') + '\n');
} else if (!signingPath || !preSubmitPath || !outputPath) {
  process.stderr.write('Independent phase-one input requires --signing, --presubmit, and --output. No action performed.\n');
  process.exitCode = 2;
} else {
  try {
    const signing = resolve(signingPath);
    const presubmit = resolve(preSubmitPath);
    const output = resolve(outputPath);
    try {
      await access(output);
      throw new Error('Output already exists; refusing to overwrite append-only evidence.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // The Lace guided flow stores exact signed CBOR *inside* the witness JSON.
    // Do not depend on an invented extra .cbor filename or treat binary CBOR
    // as UTF-8 text. The embedded bytes are already witness-digest-bound.
    const [witnessEvidence, preSubmitEvidence] = await Promise.all([
      readFile(join(signing, 'wallet-witness-evidence.json'), 'utf8').then(JSON.parse),
      readFile(presubmit, 'utf8').then(JSON.parse)
    ]);
    const signedTransactionCborHex = witnessEvidence.signedTransactionCborHex;
    if (typeof signedTransactionCborHex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(signedTransactionCborHex)) {
      throw new Error('wallet-witness-evidence.json lacks verified signedTransactionCborHex; no independent input created.');
    }
    const args = { witnessEvidence, signedTransactionCborHex, preSubmitEvidence };
    const request = createCardanoPreprodIndependentPhaseOneInput(args);
    const verification = verifyCardanoPreprodIndependentPhaseOneInput({ input: request, ...args });
    if (!verification.valid) throw new Error(verification.errors.join('; '));
    await writeFile(output, JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({
      ok: true,
      output,
      requestSha256: request.requestSha256,
      signedTransactionSha256: request.signedTransaction.sha256,
      completePhaseOneValidated: false,
      transactionSubmissionAuthorized: false,
      transactionSubmissionPerformed: false,
      nextGate: request.nextGate,
      hardStop: 'INPUT PREPARED ONLY. No independent current-ledger phase-one verdict exists; do not sign or submit.'
    }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`Independent phase-one input blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
