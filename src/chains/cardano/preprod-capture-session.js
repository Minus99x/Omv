import { hashCardanoEvidence } from './evidence-binding.js';
import {
  createCardanoPreprodSynchronizedEvaluationEvidence
} from './preprod-evidence-harness.js';
import {
  createCardanoProtocolParameterGate,
  normalizeCardanoProtocolParameterSnapshot
} from './protocol-parameters.js';

const SHA256 = /^[0-9a-f]{64}$/i;

export const CARDANO_PREPROD_CAPTURE_BASELINE = Object.freeze({
  checkpointRef: '0.6.53-dev',
  sourceCommitSha: 'e4f1c87f572d74852c7602df56e93e4efd70815e',
  archiveSha256: 'a25d23e08da6dced47fdfe2af550e1bd0e901a8aed9b69945c6c1dc9269485ce',
  sourceTreeSha256: '44f490e34761584bb9581c7bde5c3f858263134f7b2598abc42d1746ae9811a9'
});

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function exactSha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${label} must be SHA-256 hex.`);
  return value.toLowerCase();
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function withoutDigest(value, digestKey) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestKey));
}

function verifyCapturePlan(plan) {
  plainObject(plan, 'capturePlan');
  const errors = [];
  if (plan.schema !== 'omegavault.cardano.preprod-evidence-capture-plan.v1') errors.push('Capture plan schema is not supported.');
  if (plan.network !== 'preprod') errors.push('Capture plan must target Cardano Preprod.');
  if (!SHA256.test(String(plan.transactionBodyHash ?? ''))) errors.push('Capture plan transaction body hash is invalid.');
  if (!SHA256.test(String(plan.transactionCborSha256 ?? ''))) errors.push('Capture plan CBOR digest is invalid.');
  if (!SHA256.test(String(plan.planSha256 ?? ''))) errors.push('Capture plan digest is invalid.');
  if (errors.length === 0) {
    const recomputed = hashCardanoEvidence(withoutDigest(plan, 'planSha256'));
    if (recomputed !== plan.planSha256) errors.push('Capture plan self-digest mismatch.');
  }
  if (plan.liveActions?.walletSigningAuthorized !== false ||
      plan.liveActions?.transactionSubmissionAuthorized !== false ||
      plan.liveActions?.liveValueMovementAuthorized !== false) {
    errors.push('Capture plan live-action authority must remain false.');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function createCardanoPreprodCaptureSessionManifest({
  capturePlan,
  sessionId = 'omegavault-cardano-preprod-execute',
  baseline = CARDANO_PREPROD_CAPTURE_BASELINE
}) {
  const planCheck = verifyCapturePlan(capturePlan);
  if (!planCheck.ok) throw new Error(`Invalid Cardano Preprod capture plan: ${planCheck.errors.join('; ')}`);
  const id = text(sessionId, 'sessionId');
  const checkpoint = plainObject(baseline, 'baseline');
  if (checkpoint.checkpointRef !== CARDANO_PREPROD_CAPTURE_BASELINE.checkpointRef) throw new Error('Capture session must be based on the sealed 0.6.53 checkpoint.');
  exactSha(checkpoint.sourceCommitSha, 'baseline.sourceCommitSha');
  exactSha(checkpoint.archiveSha256, 'baseline.archiveSha256');
  exactSha(checkpoint.sourceTreeSha256, 'baseline.sourceTreeSha256');

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-capture-session-manifest.v1',
    network: 'preprod',
    sessionId: id,
    checkpoint: Object.freeze({
      checkpointRef: checkpoint.checkpointRef,
      sourceCommitSha: checkpoint.sourceCommitSha.toLowerCase(),
      archiveSha256: checkpoint.archiveSha256.toLowerCase(),
      sourceTreeSha256: checkpoint.sourceTreeSha256.toLowerCase()
    }),
    capturePlan,
    files: Object.freeze({
      evaluationRequest: 'ogmios-evaluation-request.json',
      acquiredTip: 'captures/acquired-tip.json',
      utxoSnapshot: 'captures/utxo-snapshot.json',
      protocolParameters: 'captures/protocol-parameters.json',
      ogmiosEvaluation: 'captures/ogmios-evaluation.json',
      phaseOneValidation: 'captures/phase-one-validation.json',
      evidence: 'cardano-preprod-synchronized-evidence.json'
    }),
    readinessRules: Object.freeze({
      exactCheckpointBaselineRequired: true,
      oneAcquiredTipRequired: true,
      minimumIndependentProtocolParameterSources: 2,
      independentProtocolParameterConfirmationRequired: true,
      independentPhaseOneValidationRequired: true,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false
    }),
    purpose: 'Prepare and verify synchronized Cardano Preprod evaluation evidence without wallet signing or transaction submission.',
    authorityBoundary: 'This manifest coordinates evidence capture only. It cannot authorize wallet signing, transaction submission, live-value movement, deployment, inclusion/finality claims or connector promotion.'
  });

  return Object.freeze({ ...core, manifestSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodCaptureSessionManifest(manifest) {
  const errors = [];
  try {
    plainObject(manifest, 'manifest');
    if (manifest.schema !== 'omegavault.cardano.preprod-capture-session-manifest.v1') errors.push('Capture session manifest schema is not supported.');
    if (manifest.network !== 'preprod') errors.push('Capture session manifest must target Cardano Preprod.');

    const baseline = manifest.checkpoint ?? {};
    for (const [field, expected] of Object.entries(CARDANO_PREPROD_CAPTURE_BASELINE)) {
      if (baseline[field] !== expected) errors.push(`Checkpoint baseline mismatch for ${field}.`);
    }

    const planCheck = verifyCapturePlan(manifest.capturePlan);
    errors.push(...planCheck.errors);

    const digest = exactSha(manifest.manifestSha256, 'manifest.manifestSha256');
    const recomputed = hashCardanoEvidence(withoutDigest(manifest, 'manifestSha256'));
    if (digest !== recomputed) errors.push('Capture session manifest self-digest mismatch.');

    if (manifest.readinessRules?.minimumIndependentProtocolParameterSources !== 2 ||
        manifest.readinessRules?.independentProtocolParameterConfirmationRequired !== true ||
        manifest.readinessRules?.independentPhaseOneValidationRequired !== true) {
      errors.push('Capture session readiness rules were weakened.');
    }
    if (manifest.readinessRules?.walletSigningAuthorized !== false ||
        manifest.readinessRules?.transactionSubmissionAuthorized !== false ||
        manifest.readinessRules?.liveValueMovementAuthorized !== false) {
      errors.push('Capture session manifest must not authorize live actions.');
    }
  } catch (error) {
    errors.push(error.message);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function evaluateCardanoPreprodCaptureSession({
  manifest,
  acquiredTip,
  utxoSnapshot,
  protocolParameterSnapshot,
  ogmiosEvaluation,
  phaseOneValidation,
  safetyMarginPercent = 10
}) {
  const manifestCheck = verifyCardanoPreprodCaptureSessionManifest(manifest);
  if (!manifestCheck.valid) throw new Error(`Cardano Preprod capture manifest is invalid: ${manifestCheck.errors.join('; ')}`);

  const normalizedParameters = normalizeCardanoProtocolParameterSnapshot(protocolParameterSnapshot);
  const parameterGate = createCardanoProtocolParameterGate([normalizedParameters]);
  if (!parameterGate.liveConstructionReady) {
    throw new Error('Current Cardano Preprod protocol parameters must be independently confirmed by at least two sources before the capture session is accepted.');
  }

  const evidence = createCardanoPreprodSynchronizedEvaluationEvidence({
    plan: manifest.capturePlan,
    acquiredTip,
    utxoSnapshot,
    protocolParameterSnapshot,
    ogmiosEvaluation,
    phaseOneValidation,
    safetyMarginPercent
  });

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-capture-session-result.v1',
    sessionId: manifest.sessionId,
    checkpoint: manifest.checkpoint,
    manifestSha256: manifest.manifestSha256,
    protocolParameterGate: Object.freeze({
      matching: parameterGate.matching,
      independentSourceCount: parameterGate.independentSourceCount,
      independentlyConfirmed: true
    }),
    synchronizedEvaluationReady: true,
    evidence,
    nextLiveGate: 'transaction-signing-and-submission-remain-separately-gated',
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false
    })
  });

  return Object.freeze({ ...core, resultSha256: hashCardanoEvidence(core) });
}
