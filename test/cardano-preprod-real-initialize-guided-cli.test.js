import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const run = args => spawnSync(process.execPath, ['scripts/cardano-preprod-real-initialize-guided.js', ...args], {
  cwd: process.cwd(),
  encoding: 'utf8'
});

test('guided Cardano real initialize exposes a one-command Windows operator flow without performing network work', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm\.cmd run cardano:preprod:real-initialize:guided/);
  assert.match(result.stdout, /clipboard/i);
  assert.match(result.stdout, /unsigned initialize candidate/i);
  assert.match(result.stdout, /Wallet signing and transaction submission remain unauthorized/i);
});

test('guided Cardano real initialize rejects all secret, signing and submission command-line arguments before prompting', () => {
  for (const flag of [
    '--private-key',
    '--secret-key',
    '--seed',
    '--seed-phrase',
    '--recovery-phrase',
    '--mnemonic',
    '--sign',
    '--submit',
    '--blockfrost-project-id',
    '--ogmios-api-key'
  ]) {
    const result = run([flag, 'forbidden']);
    assert.notEqual(result.status, 0, flag);
    assert.match(result.stderr, /forbidden/i, flag);
  }
});

test('guided Cardano real initialize validates safe numeric controls before prompting', () => {
  let result = run(['--stable-tip-retries', '0']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stable-tip-retries/i);

  result = run(['--inactivity-ms', '0']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /inactivity-ms/i);

  result = run(['--state-lovelace', '0']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /state-lovelace/i);
});
