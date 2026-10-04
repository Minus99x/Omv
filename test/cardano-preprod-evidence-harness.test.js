import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCardanoOgmiosEvaluationFixture } from '../src/chains/cardano/witness-set.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import {
  createCardanoPreprodEvidenceCapturePlan,
  createCardanoPreprodSynchronizedEvaluationEvidence,
  verifyCardanoPreprodSynchronizedEvaluationEvidence
} from '../src/chains/cardano/preprod-evidence-harness.js';

const protocolSnapshot = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
const parameters = normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);
const beacon = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vault = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCode = beacon.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCode = vault.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;

function fixture() {
  const candidate = buildCardanoOgmiosEvaluationFixture({
    action: 'execute',
    parameters,
    recoveryCompiledCode: recoveryCode,
    beaconCompiledCode: beaconCode
  });
  const plan = createCardanoPreprodEvidenceCapturePlan({
    action: 'execute',
    transactionCborHex: candidate.transactionCborHex,
    requestId: 'omegavault-preprod-execute-evaluate'
  });
  const tipHash = protocolSnapshot.tip.blockHash;
  const acquiredTip = { hash: tipHash, epoch: protocolSnapshot.tip.epoch, blockHeight: protocolSnapshot.tip.blockHeight, slot: 123456789 };
  const utxoSnapshot = {
    tipHash,
    source: 'test-fixture-node-state',
    utxos: [
      { txId: 'cd'.repeat(32), index: 0, lovelace: '10000000' },
      { txId: 'ef'.repeat(32), index: 1, lovelace: '3000000' }
    ]
  };
  const ogmiosEvaluation = {
    tipHash,
    response: {
      jsonrpc: '2.0',
      method: 'evaluateTransaction',
      id: plan.evaluationRequest.id,
      result: [
        { validator: 'spend:0', budget: { memory: 423054, cpu: 133367503 } },
        { validator: 'mint:0', budget: { memory: 91970, cpu: 27959404 } }
      ]
    }
  };
  const phaseOneValidation = {
    tipHash,
    transactionBodyHash: plan.transactionBodyHash,
    source: 'independent-cardano-ledger-phase-one-fixture',
    independentOfOgmiosEvaluation: true,
    passed: true,
    balanced: true,
    minimumAdaSatisfied: true,
    collateralSatisfied: true,
    witnessesSatisfied: true
  };
  return { plan, acquiredTip, utxoSnapshot, protocolParameterSnapshot: protocolSnapshot, ogmiosEvaluation, phaseOneValidation };
}

test('Cardano Preprod capture plan freezes the exact zero-budget evaluation candidate without authorizing live actions', () => {
  const input = fixture();
  assert.equal(input.plan.network, 'preprod');
  assert.equal(input.plan.action, 'execute');
  assert.match(input.plan.transactionBodyHash, /^[0-9a-f]{64}$/);
  assert.match(input.plan.transactionCborSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(input.plan.expectedValidators, ['mint:0', 'spend:0']);
  assert.equal(input.plan.evaluationRequest.method, 'evaluateTransaction');
  assert.equal(input.plan.liveActions.walletSigningAuthorized, false);
  assert.equal(input.plan.liveActions.transactionSubmissionAuthorized, false);
  assert.match(input.plan.planSha256, /^[0-9a-f]{64}$/);
});

test('Cardano synchronized evidence binds one acquired tip, one transaction, Ogmios budgets and independent phase-1 validation', () => {
  const input = fixture();
  const result = createCardanoPreprodSynchronizedEvaluationEvidence(input);
  assert.equal(result.status, 'synchronized-evaluation-evidence-only');
  assert.equal(result.acquiredTip.hash, input.acquiredTip.hash);
  assert.equal(result.transactionBodyHash, input.plan.transactionBodyHash);
  assert.equal(result.evidenceBundle.synchronized, true);
  assert.equal(result.evidenceBundle.phaseOneValidated, true);
  assert.equal(result.evaluation.phaseOneValidated, false);
  assert.equal(result.phaseOneValidation.independentOfOgmiosEvaluation, true);
  assert.equal(result.liveActions.publicNetworkRecoveryProven, false);
  assert.match(result.evidenceSha256, /^[0-9a-f]{64}$/);
});

test('Cardano synchronized evidence fails closed on cross-tip or cross-transaction substitution', () => {
  const input = fixture();
  assert.throws(() => createCardanoPreprodSynchronizedEvaluationEvidence({
    ...input,
    ogmiosEvaluation: { ...input.ogmiosEvaluation, tipHash: '22'.repeat(32) }
  }), /not bound to the acquired/);

  assert.throws(() => createCardanoPreprodSynchronizedEvaluationEvidence({
    ...input,
    phaseOneValidation: { ...input.phaseOneValidation, transactionBodyHash: '33'.repeat(32) }
  }), /different Cardano transaction body/);
});

test('Cardano synchronized evidence requires phase-1 validation independent of Ogmios execution-unit evaluation', () => {
  const input = fixture();
  assert.throws(() => createCardanoPreprodSynchronizedEvaluationEvidence({
    ...input,
    phaseOneValidation: { ...input.phaseOneValidation, independentOfOgmiosEvaluation: false }
  }), /must be independent/);
  assert.throws(() => createCardanoPreprodSynchronizedEvaluationEvidence({
    ...input,
    phaseOneValidation: { ...input.phaseOneValidation, balanced: false }
  }), /must pass completely/);
});

test('Cardano synchronized evidence is reproducible and tamper-detectable', () => {
  const input = fixture();
  const evidence = createCardanoPreprodSynchronizedEvaluationEvidence(input);
  const verified = verifyCardanoPreprodSynchronizedEvaluationEvidence({ evidence, ...input });
  assert.equal(verified.valid, true, verified.errors.join('; '));

  const tampered = structuredClone(evidence);
  tampered.acquiredTip.blockHeight += 1;
  const rejected = verifyCardanoPreprodSynchronizedEvaluationEvidence({ evidence: tampered, ...input });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(error => /digest mismatch/i.test(error)));
});

test('Cardano evidence harness never upgrades synchronized evaluation into submission/finality proof', () => {
  const result = createCardanoPreprodSynchronizedEvaluationEvidence(fixture());
  assert.equal(result.liveActions.walletSigningAuthorized, false);
  assert.equal(result.liveActions.transactionSubmissionAuthorized, false);
  assert.equal(result.liveActions.liveValueMovementAuthorized, false);
  assert.equal(result.liveActions.publicNetworkRecoveryProven, false);
  assert.match(result.authorityBoundary, /does not authorize or prove wallet signing, submission, inclusion, finality/i);
});
