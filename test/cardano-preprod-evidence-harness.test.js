import test from 'node:test';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCardanoPublicPreprodOgmiosEvaluationFixture } from '../src/chains/cardano/witness-set.js';
import { buildCardanoEvaluationAdditionalUtxoSet } from '../src/chains/cardano/transaction-body.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import {
  createCardanoPreprodEvidenceCapturePlan,
  createCardanoPreprodSynchronizedEvaluationEvidence,
  verifyCardanoPreprodSynchronizedEvaluationEvidence
} from '../src/chains/cardano/preprod-evidence-harness.js';

const protocolSnapshot = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
protocolSnapshot.source.independentSourceCount = 2;
protocolSnapshot.promotion.independentlyConfirmed = true;
const parameters = normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);
const beacon = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vault = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCode = beacon.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCode = vault.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;

function fixture() {
  const candidate = buildCardanoPublicPreprodOgmiosEvaluationFixture({
    action: 'execute',
    parameters,
    recoveryCompiledCode: recoveryCode,
    beaconCompiledCode: beaconCode
  });
  const plan = createCardanoPreprodEvidenceCapturePlan({
    action: 'execute',
    transactionCborHex: candidate.transactionCborHex,
    additionalUtxoSet: buildCardanoEvaluationAdditionalUtxoSet('execute'),
    requestId: 'omegavault-preprod-execute-evaluate'
  });
  const tipHash = protocolSnapshot.tip.blockHash;
  const acquiredTip = { hash: tipHash, epoch: protocolSnapshot.tip.epoch, blockHeight: protocolSnapshot.tip.blockHeight, slot: 123456789 };
  const ogmiosEvaluation = {
    tipBeforeHash: tipHash,
    tipAfterHash: tipHash,
    syntheticSupplementalUtxoContext: true,
    walletSigningPerformed: false,
    transactionSubmissionPerformed: false,
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
  return { plan, acquiredTip, protocolParameterSnapshot: protocolSnapshot, ogmiosEvaluation };
}

test('public Preprod evaluation candidate carries both required Plutus V3 witness scripts', () => {
  const candidate = buildCardanoPublicPreprodOgmiosEvaluationFixture({
    action: 'execute',
    parameters,
    recoveryCompiledCode: recoveryCode,
    beaconCompiledCode: beaconCode
  });
  const transaction = Cardano.Transaction.from_hex(candidate.transactionCborHex);
  const scripts = transaction.witness_set().plutus_scripts();
  assert.equal(scripts?.len(), 2);
  const hashes = [];
  for (let index = 0; index < scripts.len(); index += 1) {
    const script = scripts.get(index);
    assert.equal(script.language_version().kind(), Cardano.LanguageKind.PlutusV3);
    hashes.push(script.hash().to_hex());
  }
  assert.deepEqual(hashes.sort(), [
    '2f59df4cdf1199ef68d705b6a30f6738cf31075d361692cb8a58c4b4',
    '3c298bd60240d5d6d89811dc9fcffd9f37c6d60df8f74562cc01fcd6'
  ].sort());
});

test('Cardano Preprod capture plan freezes an Ogmios-resolvable zero-budget candidate without authorizing live actions', () => {
  const input = fixture();
  assert.equal(input.plan.schema, 'omegavault.cardano.preprod-evidence-capture-plan.v2');
  assert.equal(input.plan.network, 'preprod');
  assert.equal(input.plan.action, 'execute');
  assert.match(input.plan.transactionBodyHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(input.plan.expectedValidators, ['mint:0', 'spend:0']);
  assert.equal(input.plan.evaluationRequest.method, 'evaluateTransaction');
  assert.equal(input.plan.evaluationRequest.params.additionalUtxo.length, 3);
  assert.equal(input.plan.evaluationContext.syntheticSupplementalUtxoContext, true);
  assert.equal(input.plan.evaluationContext.fullPhaseOneValidationPerformed, false);
  assert.equal(input.plan.liveActions.walletSigningAuthorized, false);
  assert.equal(input.plan.liveActions.transactionSubmissionAuthorized, false);
  assert.match(input.plan.planSha256, /^[0-9a-f]{64}$/);
});

test('Cardano synchronized evaluation evidence binds one stable tip, one transaction and Ogmios budgets without claiming full phase-1', () => {
  const input = fixture();
  const result = createCardanoPreprodSynchronizedEvaluationEvidence(input);
  assert.equal(result.status, 'synchronized-public-preprod-evaluation-only');
  assert.equal(result.acquiredTip.hash, input.acquiredTip.hash);
  assert.equal(result.transactionBodyHash, input.plan.transactionBodyHash);
  assert.equal(result.evidenceBundle.synchronized, true);
  assert.equal(result.evidenceBundle.promotionReadyEvidenceBinding, false);
  assert.equal(result.validationState.synchronizedPublicPreprodEvaluationComplete, true);
  assert.equal(result.validationState.fullPhaseOneValidated, false);
  assert.equal(result.liveActions.publicNetworkRecoveryProven, false);
  assert.match(result.evidenceSha256, /^[0-9a-f]{64}$/);
});

test('Cardano synchronized evaluation fails closed when the before/after tip bracket changes', () => {
  const input = fixture();
  assert.throws(() => createCardanoPreprodSynchronizedEvaluationEvidence({
    ...input,
    ogmiosEvaluation: { ...input.ogmiosEvaluation, tipAfterHash: '22'.repeat(32) }
  }), /not bound to the acquired|not bracketed/i);
});

test('Cardano synchronized evaluation refuses signing or submission claims in a capture', () => {
  const input = fixture();
  assert.throws(() => createCardanoPreprodSynchronizedEvaluationEvidence({
    ...input,
    ogmiosEvaluation: { ...input.ogmiosEvaluation, walletSigningPerformed: true }
  }), /no-signing\/no-submission/);
  assert.throws(() => createCardanoPreprodSynchronizedEvaluationEvidence({
    ...input,
    ogmiosEvaluation: { ...input.ogmiosEvaluation, transactionSubmissionPerformed: true }
  }), /no-signing\/no-submission/);
});

test('Cardano synchronized evaluation evidence is reproducible and tamper-detectable', () => {
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

test('Cardano evidence harness never upgrades synchronized evaluation into phase-1, submission or finality proof', () => {
  const result = createCardanoPreprodSynchronizedEvaluationEvidence(fixture());
  assert.equal(result.validationState.fullPhaseOneValidated, false);
  assert.equal(result.validationState.walletWitnessesValidated, false);
  assert.equal(result.liveActions.walletSigningAuthorized, false);
  assert.equal(result.liveActions.transactionSubmissionAuthorized, false);
  assert.equal(result.liveActions.liveValueMovementAuthorized, false);
  assert.equal(result.liveActions.publicNetworkRecoveryProven, false);
  assert.match(result.authorityBoundary, /does not prove full phase-1 validity.*wallet witnesses.*submission.*finality/i);
});
