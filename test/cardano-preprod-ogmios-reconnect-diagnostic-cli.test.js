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

test('Ogmios reconnect diagnostic fails closed without provider credentials', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires OMEGAVAULT_OGMIOS_URL and OMEGAVAULT_OGMIOS_API_KEY/i);
});
