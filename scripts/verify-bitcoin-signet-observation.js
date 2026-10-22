import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBitcoinSignetObservationProof } from '../src/chains/bitcoin/signet-evidence.js';
import { createBitcoinSignetObservationCoreCliDriver } from '../src/chains/bitcoin/signet-core-cli-driver.js';

// Only fixed local read-only Bitcoin Core queries. No broadcast, wallet or secrets.
const permitted = new Set(['--finalizer','--final-transaction','--output','--minimum-confirmations']);
const provided = new Map();
for (let i=2;i<process.argv.length;) {
  const flag = process.argv[i++];
  if (!permitted.has(flag) || provided.has(flag) || i >= process.argv.length ||
      process.argv[i].startsWith('--')) {
    throw new Error('Unsupported, duplicate, missing, or unsafe Bitcoin Signet proof option: ' + flag);
  }
  provided.set(flag, process.argv[i++]);
}
for (const flag of ['--finalizer','--final-transaction','--output']) {
  if (!provided.get(flag)) throw new Error('Required Bitcoin Signet proof option: ' + flag);
}
const depthText = provided.get('--minimum-confirmations') ?? '6';
if (!/^[1-9]\d*$/.test(depthText) || !Number.isSafeInteger(Number(depthText)) ||
    Number(depthText) > 0xffffffff) {
  throw new TypeError('minimum-confirmations must be a positive uint32 integer.');
}
const finalizerEvidence = JSON.parse(readFileSync(resolve(provided.get('--finalizer')), 'utf8'));
const finalTransactionEvidence = JSON.parse(readFileSync(resolve(provided.get('--final-transaction')), 'utf8'));
const proof = await runBitcoinSignetObservationProof({
  driver:createBitcoinSignetObservationCoreCliDriver(),
  finalizerEvidence, finalTransactionEvidence,
  minimumConfirmations:Number(depthText), observationSource:'bitcoin-core-rpc'
});
const path = resolve(provided.get('--output'));
writeFileSync(path, JSON.stringify(proof.evidence, null, 2) + '\n', {flag:'wx'});
process.stdout.write('BITCOIN_SIGNET_READONLY_OBSERVATION_OK ' + proof.evidence.sha256 + '\n');
