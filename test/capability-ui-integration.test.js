import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('browser UI fetches the validated capability endpoint', () => {
  assert.match(app, /api\('\/api\/chain-capabilities'\)/);
  assert.match(app, /createCapabilityUiModel/);
  assert.match(app, /No promotion claim is being made/);
});

test('browser capability dashboard exposes status and chain cards', () => {
  assert.match(html, /id="capabilityStatus"/);
  assert.match(html, /id="capabilityGrid"/);
  assert.match(html, /Single source of truth/);
  assert.match(css, /\.capability-grid/);
  assert.match(css, /\.capability-badge\.blocked/);
});
