import test from 'node:test';
import assert from 'node:assert/strict';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import {
  CARDANO_PREPROD_CAPTURE_BASELINE,
  createCardanoPreprodCaptureSessionManifest,
  verifyCardanoPreprodCaptureSessionManifest
} from '../src/chains/cardano/preprod-capture-session.js';

const additionalUtxoSet = [{
  transaction: { id: 'aa'.repeat(32) },
  index: 0,
  address: 'addr_test1vptest',
  value: { ada: { lovelace: 10000000 } }
}];
const planCore = {
  schema: 'omegavault.cardano.preprod-evidence-capture-plan.v2',
  network: 'preprod',
  action: 'execute',
  captureLabel: 'test',
  transactionBodyHash: '11'.repeat(32),
  transactionCborHex: '84'.repeat(8),
  transactionCborSha256: '22'.repeat(32),
  evaluationRequest: {
    jsonrpc: '2.0',
    method: 'evaluateTransaction',
    params: { transaction: { cbor: '84'.repeat(8) }, additionalUtxo: additionalUtxoSet },
    id: 'test'
  },
  evaluationContext: {
    supplementalUtxoSha256: hashCardanoEvidence(additionalUtxoSet),
    syntheticSupplementalUtxoContext: true,
    keyWitnessesRequiredForEvaluation: false,
    fullPhaseOneValidationPerformed: false
  },
  expectedValidators: ['spend:0'],
  requiredCaptures: ['acquired-stable-tip', 'same-tip-current-protocol-parameters-with-independent-confirmation', 'tip-bracketed-ogmios-evaluation-response'],
  liveActions: {
    walletSigningAuthorized: false,
    transactionSubmissionAuthorized: false,
    liveValueMovementAuthorized: false
  },
  authorityBoundary: 'test-only'
};
const plan = Object.freeze({ ...planCore, planSha256: hashCardanoEvidence(planCore) });

test('Cardano capture session manifest is pinned to the exact sealed 0.6.58 checkpoint', () => {
  const manifest = createCardanoPreprodCaptureSessionManifest({ capturePlan: plan, sessionId: 'unit-test' });
  assert.deepEqual(manifest.checkpoint, CARDANO_PREPROD_CAPTURE_BASELINE);
  assert.equal(manifest.schema, 'omegavault.cardano.preprod-capture-session-manifest.v2');
  assert.equal(manifest.readinessRules.minimumIndependentProtocolParameterSources, 2);
  assert.equal(manifest.readinessRules.tipBracketedOgmiosEvaluationRequired, true);
  assert.equal(manifest.readinessRules.fullPhaseOneValidationClaimAuthorized, false);
  assert.equal(manifest.invariantProgram.checkpoint.checkpointRef, '0.6.58-dev');
  assert.equal(manifest.invariantProgram.requiredEvidenceLevel, 'public-testnet');
  assert.equal(manifest.invariantProgram.supportClaimAuthorized, false);
  assert.equal(manifest.readinessRules.walletSigningAuthorized, false);
  assert.equal(manifest.readinessRules.transactionSubmissionAuthorized, false);
  assert.equal(verifyCardanoPreprodCaptureSessionManifest(manifest).valid, true);
});

test('Cardano capture session manifest fails closed on checkpoint or authority tampering', () => {
  const manifest = createCardanoPreprodCaptureSessionManifest({ capturePlan: plan, sessionId: 'unit-test' });
  const wrongCheckpoint = structuredClone(manifest);
  wrongCheckpoint.checkpoint.archiveSha256 = '33'.repeat(32);
  assert.equal(verifyCardanoPreprodCaptureSessionManifest(wrongCheckpoint).valid, false);

  const escalated = structuredClone(manifest);
  escalated.readinessRules.walletSigningAuthorized = true;
  assert.equal(verifyCardanoPreprodCaptureSessionManifest(escalated).valid, false);

  const phaseOneEscalation = structuredClone(manifest);
  phaseOneEscalation.readinessRules.fullPhaseOneValidationClaimAuthorized = true;
  assert.equal(verifyCardanoPreprodCaptureSessionManifest(phaseOneEscalation).valid, false);
});
