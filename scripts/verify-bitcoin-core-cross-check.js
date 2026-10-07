import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBitcoinCoreCrossCheckEvidence } from '../src/chains/bitcoin/core-cross-check.js';

const forbidden = ['--private-key', '--secret-key', '--seed', '--rpc-password', '--rpc-cookie', '--wallet', '--key-output']
  .find(flag => process.argv.includes(flag));
if (forbidden) throw new Error(`${forbidden} is forbidden: this verifier accepts public read-only observations only.`);

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function exactFields(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} fields must be exactly: ${wanted.join(', ')}.`);
}

const transactionPath = arg('transaction');
const observationsPath = arg('observations');
const outputPath = arg('output');
if (!transactionPath || !observationsPath) {
  process.stderr.write('Usage: node scripts/verify-bitcoin-core-cross-check.js --transaction <json> --observations <json> [--expected-node-version <integer>] [--output <json>]\n');
  process.exit(2);
}
if (outputPath && existsSync(resolve(outputPath))) throw new Error(`Output already exists: ${resolve(outputPath)}`);

const transaction = JSON.parse(readFileSync(resolve(transactionPath), 'utf8'));
const observations = JSON.parse(readFileSync(resolve(observationsPath), 'utf8'));
exactFields(observations, ['schema', 'node', 'decodedTransaction', 'mempoolResult'], 'Bitcoin Core observation import');
if (observations.schema !== 'omegavault.bitcoin.core-cross-check-observations.v1') throw new Error('Unsupported Bitcoin Core observation import schema.');

const expectedNodeVersionText = arg('expected-node-version') ?? '310100';
if (!/^\d+$/.test(expectedNodeVersionText)) throw new TypeError('expected-node-version must be a positive integer.');
const expectedNodeVersion = Number(expectedNodeVersionText);
const evidence = createBitcoinCoreCrossCheckEvidence({
  transaction,
  node:observations.node,
  decodedTransaction:observations.decodedTransaction,
  mempoolResult:observations.mempoolResult,
  expectedNodeVersion,
  observationSource:'imported-json'
});

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (outputPath) writeFileSync(resolve(outputPath), serialized, { encoding:'utf8', flag:'wx' });
else process.stdout.write(serialized);
