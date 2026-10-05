import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(args) {
  return spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
}

test('Cardano Preprod session CLI prepares an offline checkpoint-bound manifest and reports missing captures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-cardano-session-'));
  const prepared = run(['scripts/prepare-cardano-preprod-session.js', '--output', dir, '--action', 'execute']);
  assert.equal(prepared.status, 0, prepared.stderr);
  const prep = JSON.parse(prepared.stdout);
  assert.equal(prep.ok, true);
  assert.equal(prep.networkRequestsPerformed, false);
  assert.equal(prep.walletSigningAuthorized, false);
  assert.equal(prep.supportClaimAuthorized, false);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'capture-manifest.json'), 'utf8'));
  assert.equal(manifest.checkpoint.checkpointRef, '0.6.58-dev');
  assert.equal(manifest.checkpoint.sourceCommitSha, 'f3f67a62d66dc9a509c85d33eb35674133e08bb3');
  assert.equal(fs.existsSync(path.join(dir, manifest.files.evaluationRequest)), true);

  const status = run(['scripts/verify-cardano-preprod-session.js', '--session', dir]);
  assert.equal(status.status, 2);
  const report = JSON.parse(status.stdout);
  assert.equal(report.state, 'capture-incomplete');
  assert.equal(report.missing.length, 5);
  assert.equal(report.walletSigningAuthorized, false);
  assert.equal(report.transactionSubmissionAuthorized, false);
  assert.equal(report.supportClaimAuthorized, false);
});

test('Cardano Preprod session CLI binds complete synchronized captures and still refuses signing/submission authority', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-cardano-session-complete-'));
  const prepared = run(['scripts/prepare-cardano-preprod-session.js', '--output', dir, '--action', 'execute']);
  assert.equal(prepared.status, 0, prepared.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'capture-manifest.json'), 'utf8'));

  const protocol = JSON.parse(fs.readFileSync('docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', 'utf8'));
  protocol.source.independentSourceCount = 2;
  protocol.promotion.independentlyConfirmed = true;
  const tipHash = protocol.tip.blockHash;

  const captures = {
    acquiredTip: { hash: tipHash, epoch: protocol.tip.epoch, slot: 123456789, blockHeight: protocol.tip.blockHeight },
    utxoSnapshot: {
      tipHash,
      source: 'independent-test-node',
      capturedAt: '2026-10-04T20:00:00Z',
      utxos: [
        { txId: 'cd'.repeat(32), index: 0, lovelace: '10000000' },
        { txId: 'ef'.repeat(32), index: 1, lovelace: '3000000' }
      ]
    },
    protocolParameters: protocol,
    ogmiosEvaluation: {
      tipHash,
      response: {
        jsonrpc: '2.0',
        method: 'evaluateTransaction',
        id: manifest.capturePlan.evaluationRequest.id,
        result: [
          { validator: 'spend:0', budget: { memory: 423054, cpu: 133367503 } },
          { validator: 'mint:0', budget: { memory: 91970, cpu: 27959404 } }
        ]
      }
    },
    phaseOneValidation: {
      tipHash,
      transactionBodyHash: manifest.capturePlan.transactionBodyHash,
      source: 'independent-ledger-phase-one-test',
      independentOfOgmiosEvaluation: true,
      passed: true,
      balanced: true,
      minimumAdaSatisfied: true,
      collateralSatisfied: true,
      witnessesSatisfied: true
    }
  };

  for (const [key, value] of Object.entries(captures)) {
    const file = path.join(dir, manifest.files[key]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  const verified = run(['scripts/verify-cardano-preprod-session.js', '--session', dir]);
  assert.equal(verified.status, 0, verified.stderr);
  const report = JSON.parse(verified.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.state, 'synchronized-evaluation-evidence-ready');
  assert.equal(report.independentProtocolParameterSources, 2);
  assert.equal(report.walletSigningAuthorized, false);
  assert.equal(report.transactionSubmissionAuthorized, false);
  assert.equal(report.publicNetworkRecoveryProven, false);
  assert.equal(report.invariantLifecycleProgramComplete, false);
  assert.equal(report.supportClaimAuthorized, false);

  const evidence = JSON.parse(fs.readFileSync(path.join(dir, manifest.files.evidence), 'utf8'));
  assert.equal(evidence.synchronizedEvaluationReady, true);
  assert.equal(evidence.liveActions.walletSigningAuthorized, false);
  assert.equal(evidence.liveActions.transactionSubmissionAuthorized, false);
  assert.match(evidence.resultSha256, /^[0-9a-f]{64}$/);
});
