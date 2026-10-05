import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(args) {
  return spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
}

test('Cardano campaign CLI prepares all four offline sessions and reports capture gaps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-cardano-campaign-'));
  const prepared = run(['scripts/prepare-cardano-preprod-campaign.js', '--output', dir]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const prep = JSON.parse(prepared.stdout);
  assert.equal(prep.ok, true);
  assert.equal(prep.sessionCount, 4);
  assert.deepEqual(prep.actions, ['initialize', 'heartbeat', 'approve', 'execute']);
  assert.equal(prep.networkRequestsPerformed, false);
  assert.equal(prep.walletSigningAuthorized, false);
  assert.equal(prep.transactionSubmissionAuthorized, false);
  assert.equal(prep.supportClaimAuthorized, false);

  const campaign = JSON.parse(fs.readFileSync(path.join(dir, 'campaign-manifest.json'), 'utf8'));
  assert.equal(campaign.checkpoint.checkpointRef, '0.6.58-dev');
  assert.equal(campaign.sessions.length, 4);
  assert.equal(fs.existsSync(path.join(dir, 'RUNBOOK.md')), true);
  for (const entry of campaign.sessions) {
    const manifestPath = path.join(dir, entry.directory, 'capture-manifest.json');
    assert.equal(fs.existsSync(manifestPath), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.capturePlan.action, entry.action);
    assert.equal(manifest.manifestSha256, entry.manifestSha256);
  }

  const verified = run(['scripts/verify-cardano-preprod-campaign.js', '--campaign', dir]);
  assert.equal(verified.status, 2, verified.stderr);
  const status = JSON.parse(verified.stdout);
  assert.equal(status.state, 'campaign-capture-incomplete');
  assert.equal(status.incomplete.length, 4);
  assert.equal(status.incomplete.reduce((sum, item) => sum + item.missing.length, 0), 20);
  assert.equal(status.synchronizedEvaluationCampaignComplete, false);
  assert.equal(status.walletSigningAuthorized, false);
  assert.equal(status.transactionSubmissionAuthorized, false);
  assert.equal(status.publicNetworkRecoveryProven, false);
  assert.equal(status.supportClaimAuthorized, false);
});

test('Cardano campaign CLI fails closed when one action manifest is replaced by another', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-cardano-campaign-crosswire-'));
  const prepared = run(['scripts/prepare-cardano-preprod-campaign.js', '--output', dir]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const campaign = JSON.parse(fs.readFileSync(path.join(dir, 'campaign-manifest.json'), 'utf8'));
  const approve = campaign.sessions.find(item => item.action === 'approve');
  const execute = campaign.sessions.find(item => item.action === 'execute');
  const executeBytes = fs.readFileSync(path.join(dir, execute.directory, 'capture-manifest.json'));
  fs.writeFileSync(path.join(dir, approve.directory, 'capture-manifest.json'), executeBytes);

  const verified = run(['scripts/verify-cardano-preprod-campaign.js', '--campaign', dir]);
  assert.equal(verified.status, 2);
  assert.match(verified.stderr, /approve.*digest|approve.*cross-wired/i);
});
