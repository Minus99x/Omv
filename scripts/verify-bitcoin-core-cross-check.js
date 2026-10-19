import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
function extractPreparedTransaction(value) {
  if (value?.schema !== 'omegavault.bitcoin.signet-offline-recovery-preparation.v1') return value;
  exactFields(value, [
    'schema','networkRef','transaction','finalTransactionEvidence','operatorExpectedFeeSats',
    'readyForBroadcast','bitcoinCoreCrossCheckProven','signetExecutionProven','authorityBoundary'
  ], 'Bitcoin Signet offline preparation artifact');
  if (value.networkRef !== 'bitcoin:signet' || value.readyForBroadcast !== false ||
      value.bitcoinCoreCrossCheckProven !== false || value.signetExecutionProven !== false ||
      value.transaction?.networkRef !== 'bitcoin:signet' ||
      value.transaction?.broadcastAuthorized !== false ||
      value.transaction?.signetExecutionProven !== false) {
    throw new Error('Offline preparation artifact illegally claims network or transaction authority.');
  }
  const evidence = value.finalTransactionEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Offline preparation artifact has no final-transaction evidence.');
  }
  const {sha256,...core} = evidence;
  const recalculated = createHash('sha256').update(JSON.stringify(canonical(core))).digest('hex');
  const rawHex = value.transaction?.rawHex;
  if (sha256 !== recalculated || evidence.txid !== value.transaction?.txid ||
      evidence.wtxid !== value.transaction?.wtxid ||
      evidence.finalizerEvidenceSha256 !== value.transaction?.finalizerEvidence?.sha256 ||
      evidence.feeSats !== value.operatorExpectedFeeSats ||
      evidence.rescueScriptPubKey !== value.transaction?.finalizerEvidence?.rescueScriptPubKey ||
      evidence.rawTransactionSha256 !==
        (typeof rawHex === 'string' && /^[0-9a-f]+$/.test(rawHex) && rawHex.length % 2 === 0 ?
         createHash('sha256').update(Buffer.from(rawHex,'hex')).digest('hex') : null)) {
    throw new Error('Offline preparation artifact does not bind the exact extracted transaction and fee.');
  }
  return value.transaction;
}

const transaction = extractPreparedTransaction(JSON.parse(readFileSync(resolve(transactionPath), 'utf8')));
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
