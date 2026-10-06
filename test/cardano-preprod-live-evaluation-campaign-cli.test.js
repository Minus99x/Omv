import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const run = args => spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, OMEGAVAULT_OGMIOS_URL: '', BLOCKFROST_PROJECT_ID: '' } });

test('live Preprod evaluation campaign refuses to start without campaign destination', () => {
  const result = run(['scripts/capture-cardano-preprod-evaluation-campaign.js']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires --campaign/);
});

test('live Preprod evaluation campaign refuses missing Ogmios endpoint before any network activity', () => {
  const campaign = path.join(os.tmpdir(), `omegavault-live-eval-missing-ogmios-${process.pid}`);
  const result = run(['scripts/capture-cardano-preprod-evaluation-campaign.js', '--campaign', campaign]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /OMEGAVAULT_OGMIOS_URL/);
  assert.equal(fs.existsSync(path.join(campaign, 'campaign-manifest.json')), false);
});

test('live Preprod evaluation campaign refuses missing Blockfrost confirmation before campaign creation', () => {
  const campaign = path.join(os.tmpdir(), `omegavault-live-eval-missing-blockfrost-${process.pid}`);
  const result = run([
    'scripts/capture-cardano-preprod-evaluation-campaign.js',
    '--campaign', campaign,
    '--ogmios-url', 'https://example.invalid'
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BLOCKFROST_PROJECT_ID/);
  assert.equal(fs.existsSync(path.join(campaign, 'campaign-manifest.json')), false);
});


test('live Preprod evaluation campaign refuses an existing destination before network capture', () => {
  const campaign = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-live-eval-existing-'));
  const result = run([
    'scripts/capture-cardano-preprod-evaluation-campaign.js',
    '--campaign', campaign,
    '--ogmios-url', 'https://example.invalid',
    '--blockfrost-project-id', 'preprod-test-key'
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /destination already exists/i);
  fs.rmSync(campaign, { recursive: true, force: true });
});
