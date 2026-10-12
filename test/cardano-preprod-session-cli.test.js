import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(args) {
  return spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
}

test('Cardano Preprod session CLI prepares an offline checkpoint-bound manifest and reports three missing external captures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-cardano-session-'));
  const prepared = run(['scripts/prepare-cardano-preprod-session.js', '--output', dir, '--action', 'execute']);
  assert.equal(prepared.status, 0, prepared.stderr);
  const prep = JSON.parse(prepared.stdout);
  assert.equal(prep.ok, true);
  assert.equal(prep.externalCaptureFileCount, 3);
  assert.equal(prep.fullPhaseOneValidated, false);
  assert.equal(prep.networkRequestsPerformed, false);
  assert.equal(prep.walletSigningAuthorized, false);
  assert.equal(prep.supportClaimAuthorized, false);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'capture-manifest.json'), 'utf8'));
  assert.equal(manifest.checkpoint.checkpointRef, '0.6.58-dev');
  assert.equal(manifest.checkpoint.sourceCommitSha, 'f3f67a62d66dc9a509c85d33eb35674133e08bb3');
  assert.equal(fs.existsSync(path.join(dir, manifest.files.evaluationRequest)), true);
  assert.equal(manifest.capturePlan.evaluationRequest.params.additionalUtxo.length, 3);

  const status = run(['scripts/verify-cardano-preprod-session.js', '--session', dir]);
  assert.equal(status.status, 2);
  const report = JSON.parse(status.stdout);
  assert.equal(report.state, 'evaluation-capture-incomplete');
  assert.equal(report.missing.length, 3);
  assert.equal(report.fullPhaseOneValidated, false);
  assert.equal(report.walletSigningAuthorized, false);
  assert.equal(report.transactionSubmissionAuthorized, false);
  assert.equal(report.supportClaimAuthorized, false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Cardano Preprod session CLI binds complete stable-tip evaluation captures and still refuses phase-1/signing/submission claims', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-cardano-session-complete-'));
  const prepared = run(['scripts/prepare-cardano-preprod-session.js', '--output', dir, '--action', 'execute']);
  assert.equal(prepared.status, 0, prepared.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'capture-manifest.json'), 'utf8'));

  const protocol = JSON.parse(fs.readFileSync('docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', 'utf8'));
  protocol.source.independentSourceCount = 2;
  protocol.promotion.independentlyConfirmed = true;
  // Public evaluation is permitted without separately authorizing live construction.
  protocol.promotion.eligibleForLiveTransactionConstruction = false;
  protocol.promotion.connectorLiveProof = false;
  const tipHash = protocol.tip.blockHash;

  const captures = {
    acquiredTip: { hash: tipHash, epoch: protocol.tip.epoch, slot: 123456789, blockHeight: protocol.tip.blockHeight },
    protocolParameters: protocol,
    ogmiosEvaluation: {
      tipBeforeHash: tipHash,
      tipAfterHash: tipHash,
      syntheticSupplementalUtxoContext: true,
      walletSigningPerformed: false,
      transactionSubmissionPerformed: false,
      response: {
        jsonrpc: '2.0',
        method: 'evaluateTransaction',
        id: manifest.capturePlan.evaluationRequest.id,
        result: [
          { validator: 'spend:0', budget: { memory: 423054, cpu: 133367503 } },
          { validator: 'mint:0', budget: { memory: 91970, cpu: 27959404 } }
        ]
      }
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
  assert.equal(report.state, 'synchronized-public-preprod-evaluation-ready');
  assert.equal(report.independentProtocolParameterSources, 2);
  assert.equal(report.synchronizedEvaluationComplete, true);
  assert.equal(report.fullPhaseOneValidated, false);
  assert.equal(report.walletSigningAuthorized, false);
  assert.equal(report.transactionSubmissionAuthorized, false);
  assert.equal(report.publicNetworkRecoveryProven, false);
  assert.equal(report.invariantLifecycleProgramComplete, false);
  assert.equal(report.supportClaimAuthorized, false);

  const evidence = JSON.parse(fs.readFileSync(path.join(dir, manifest.files.evidence), 'utf8'));
  assert.equal(evidence.synchronizedEvaluationReady, true);
  assert.equal(evidence.fullPhaseOneValidated, false);
  assert.equal(evidence.liveActions.walletSigningAuthorized, false);
  assert.equal(evidence.liveActions.transactionSubmissionAuthorized, false);
  assert.match(evidence.resultSha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.liveActions.walletSigningAuthorized, false);
  assert.equal(evidence.liveActions.transactionSubmissionAuthorized, false);

  // Reuse the same coherent evaluation but remove independent provider
  // evidence: the capture must fail closed rather than treating flags as proof.
  const protocolFile = path.join(dir, manifest.files.protocolParameters);
  for (const weaken of [
    input => { input.source.independentSourceCount = 1; },
    input => { input.promotion.independentlyConfirmed = false; }
  ]) {
    const unconfirmed = structuredClone(protocol);
    weaken(unconfirmed);
    fs.writeFileSync(protocolFile, `${JSON.stringify(unconfirmed, null, 2)}\n`);
    const rejected = run(['scripts/verify-cardano-preprod-session.js', '--session', dir]);
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /independently confirmed by at least two sources/);
  }

  fs.rmSync(dir, { recursive: true, force: true });
});
