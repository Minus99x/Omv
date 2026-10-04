import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/chains/bitcoin/psbt-v2.js', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('Bitcoin source exports the strict recovery transaction finalizer', () => {
  assert.match(source, /export function finalizePsbtV2RecoveryTransaction/);
  assert.match(source, /exactly one caller-confirmed rescue output/);
  assert.match(source, /Bitcoin recovery fee mismatch/);
});

test('Bitcoin finalizer enforces descriptor, CSV, threshold, and signer boundaries', () => {
  assert.match(source, /witness script does not match the configured descriptor/);
  assert.match(source, /has not encoded the required CSV delay/);
  assert.match(source, /does not meet the configured signature threshold/);
  assert.match(source, /contains an unauthorized partial signer/);
});

test('Bitcoin finalizer constructs the delayed recovery witness and segwit serialization', () => {
  assert.match(source, /CHECKMULTISIG dummy element/);
  assert.match(source, /empty owner signature selects the delayed recovery branch/);
  assert.match(source, /Buffer\.from\(\[0x00, 0x01\]\)/);
  assert.match(source, /txid: displayHash\(stripped\)/);
  assert.match(source, /wtxid: displayHash\(raw\)/);
});

test('Project-wide syntax check now includes Bitcoin descriptor and PSBT execution modules', () => {
  assert.match(pkg.scripts.check, /node --check src\/chains\/bitcoin\/descriptor\.js/);
  assert.match(pkg.scripts.check, /node --check src\/chains\/bitcoin\/psbt-v2\.js/);
});
