import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

function matches(pattern, text) {
  return [...text.matchAll(pattern)].map(match => match[1]);
}

test('every DOM id referenced through $() exists in the page', () => {
  const used = new Set(matches(/\$\('([^']+)'\)/g, app));
  const present = new Set(matches(/id="([^"]+)"/g, html));
  const missing = [...used].filter(id => !present.has(id));
  assert.deepEqual(missing, []);
});

test('UI defines no seed phrase, mnemonic, or private-key input field', () => {
  const inputLike = matches(/<(?:input|textarea)[^>]*(?:id|name)="([^"]+)"[^>]*>/gi, html).join(' ').toLowerCase();
  assert.doesNotMatch(inputLike, /seed|mnemonic|private.?key|recovery.?phrase/);
});

test('page communicates Sepolia-only proof mode', () => {
  assert.match(html, /Sepolia testnet only/i);
  assert.match(html, /Guardrail:/i);
});
