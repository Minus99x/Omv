import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('CSP allows WebAssembly compilation without enabling general unsafe-eval', () => {
  assert.match(server, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(server, /script-src[^;]*'unsafe-eval'/);
});
