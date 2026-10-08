import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = resolve(root, 'scripts/cardano-preprod-lace-sign-guided.js');

test('guided Lace signing help exposes signing-only boundary and explicit authorization', () => {
  const result = spawnSync(process.execPath, [script, '--help'], {
    cwd:root,
    encoding:'utf8',
    stdio:['ignore','pipe','pipe']
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--authorize-signing/);
  assert.match(result.stdout, /--expected-body-hash/);
  assert.match(result.stdout, /binds the explicit signing authorization/i);
  assert.match(result.stdout, /no transaction-submission path/i);
  assert.match(result.stdout, /CIP-30/i);
});

test('guided Lace signing gate refuses to start without explicit signing authorization', () => {
  const result = spawnSync(process.execPath, [script, '--capture', 'fixture-capture'], {
    cwd:root,
    encoding:'utf8',
    stdio:['ignore','pipe','pipe']
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /explicit --authorize-signing is required/i);
  assert.match(result.stderr, /never submission/i);
});


test('guided Lace signing gate requires an exact body-hash-bound authorization', () => {
  const result = spawnSync(process.execPath, [script, '--capture', 'fixture-capture', '--authorize-signing'], {
    cwd:root,
    encoding:'utf8',
    stdio:['ignore','pipe','pipe']
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--expected-body-hash/i);
  assert.match(result.stderr, /exact 64-hex frozen transaction body hash/i);
});

test('guided Lace signing source contains no wallet submission call', () => {
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /\.submitTx\s*\(/);
  assert.doesNotMatch(source, /\bsubmitTx\s*\(/);
  assert.match(source, /api\.signTx\(/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /signingAuthorizationBodyHash/);
});
