import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const run = args => spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });

test('Cardano operator handoff reports the sealed checkpoint, fastest infrastructure path and authority boundary', () => {
  const result = run(['scripts/cardano-preprod-operator-handoff.js']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.sealedCheckpoint.ref, '0.6.59-dev');
  assert.equal(report.sealedCheckpoint.commit, '1353fe9fd94fcbdd787fd594c85937e934b60571');
  assert.equal(report.network.name, 'Cardano Preprod');
  assert.equal(report.network.networkMagic, 1);
  assert.equal(report.fastestInfrastructurePath.localCardanoNodeRequired, false);
  assert.equal(report.fastestInfrastructurePath.fullChainSyncRequired, false);
  assert.equal(report.fastestInfrastructurePath.independentProtocolParameterSourcesRequired, 2);
  assert.equal(report.faucet.requiredForCurrentSynchronizedEvaluationOnlyGate, false);
  assert.equal(report.faucet.requiredBeforeAnyLaterSignedPublicNetworkTransactionGate, true);
  assert.equal(report.operatorBoundary.walletSigningAuthorized, false);
  assert.equal(report.operatorBoundary.transactionSubmissionAuthorized, false);
  assert.equal(report.operatorBoundary.supportClaimAuthorized, false);
  assert.equal(report.currentEvidenceScope.fullPhaseOneValidationRemainsSeparateLaterGate, true);
  assert.equal(report.networkRequestsPerformed, false);
});

test('Cardano operator handoff inventories all four prepared campaign sessions and missing external captures', () => {
  const campaign = path.join(os.tmpdir(), `omegavault-operator-handoff-${process.pid}-${Date.now()}`);
  const prepared = run(['scripts/prepare-cardano-preprod-campaign.js', '--output', campaign]);
  assert.equal(prepared.status, 0, prepared.stderr);

  const result = run(['scripts/cardano-preprod-operator-handoff.js', '--campaign', campaign]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.campaign.exists, true);
  assert.equal(report.campaign.structurallyReady, true);
  assert.deepEqual(report.campaign.actions, ['initialize', 'heartbeat', 'approve', 'execute']);
  assert.equal(report.campaign.incomplete.length, 4);
  for (const entry of report.campaign.incomplete) assert.equal(entry.missing.length, 3);
  assert.equal(report.operatorBoundary.walletSigningAuthorized, false);
  assert.equal(report.networkRequestsPerformed, false);

  fs.rmSync(campaign, { recursive: true, force: true });
});
