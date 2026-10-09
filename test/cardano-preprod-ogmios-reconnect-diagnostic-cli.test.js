import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const run = (args = [], env = {}) => spawnSync(process.execPath, ['scripts/cardano-preprod-ogmios-reconnect-diagnostic.js', ...args], {
  cwd:process.cwd(),
  encoding:'utf8',
  env:{ ...process.env, OMEGAVAULT_OGMIOS_URL:'', OMEGAVAULT_OGMIOS_API_KEY:'', ...env }
});

test('Ogmios reconnect diagnostic help documents two sequential read-only connections', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fully closes it/i);
  assert.match(result.stdout, /second authenticated/i);
  assert.match(result.stdout, /No wallet signing/i);
  assert.match(result.stdout, /submission/i);
});

test('Ogmios reconnect diagnostic fails closed without an endpoint URL', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires OMEGAVAULT_OGMIOS_URL/i);
  assert.doesNotMatch(result.stderr, /and OMEGAVAULT_OGMIOS_API_KEY/i);
});

test('Ogmios reconnect diagnostic can attempt an authenticated endpoint URL without a separate API-key header', () => {
  const result = run([], {
    OMEGAVAULT_OGMIOS_URL:'ws://127.0.0.1:1',
    OMEGAVAULT_OGMIOS_API_KEY:''
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /first authenticated read-only connection/i);
  assert.doesNotMatch(result.stderr, /requires OMEGAVAULT_OGMIOS_API_KEY/i);
});
