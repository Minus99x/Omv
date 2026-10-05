import { hashCardanoEvidence } from './evidence-binding.js';
import {
  createCardanoPreprodInvariantEvidenceProgram,
  verifyCardanoPreprodInvariantEvidenceProgram
} from './preprod-invariant-program.js';
import {
  createCardanoPreprodSynchronizedEvaluationEvidence
} from './preprod-evidence-harness.js';
import {
  createCardanoProtocolParameterGate,
  normalizeCardanoProtocolParameterSnapshot
} from './protocol-parameters.js';

const SHA256 = /^[0-9a-f]{64}$/i;
const GIT_SHA = /^[0-9a-f]{40}$/i;

export const CARDANO_PREPROD_CAPTURE_BASELINE = Object.freeze({
  checkpointRef: '0.6.58-dev',
  sourceCommitSha: 'f3f67a62d66dc9a509c85d33eb35674133e08bb3',
  archiveSha256: '2e9129ed9d1eac5c61d85b625aebd7828988da8298c7b5914169769fde2bb463',
  sourceTreeSha256: '59d543758df1915d36b4f7b984425a37503468704c187c6ceb4ed3cfd763ff58'
});

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function exactSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${label} must be SHA-256 hex.`);
  return value.toLowerCase();
}

function exactGitSha(value, label) {
  if (typeof value !== 'string' || !GIT_SHA.test(value)) throw new TypeError(`${label} must be a 40-character Git commit SHA.`);
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
  if (plan.schema !== 'omegavault.cardano.preprod-evidence-capture-plan.v2') errors.push('Capture plan schema is not supported.');
  if (plan.network !== 'preprod') errors.push('Capture plan must target Cardano Preprod.');
  if (!SHA256.test(String(plan.transactionBodyHash ?? ''))) errors.push('Capture plan transaction body hash is invalid.');
  if (!SHA256.test(String(plan.transactionCborSha256 ?? ''))) errors.push('Capture plan CBOR digest is invalid.');
  if (!SHA256.test(String(plan.planSha256 ?? ''))) errors.push('Capture plan digest is invalid.');
  if (!SHA256.test(String(plan.evaluationContext?.supplementalUtxoSha256 ?? ''))) errors.push('Capture plan supplemental UTxO digest is invalid.');
  if (!Array.isArray(plan.evaluationRequest?.params?.additionalUtxoSet) || plan.evaluationRequest.params.additionalUtxoSet.length < 1) {
    errors.push('Capture plan must carry a supplemental UTxO evaluation context.');
  }
  if (plan.evaluationContext?.syntheticSupplementalUtxoContext !== true ||
      plan.evaluationContext?.fullPhaseOneValidationPerformed !== false) {
    errors.push('Capture plan evaluation-only boundary is invalid.');
  }
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
  if (checkpoint.checkpointRef !== CARDANO_PREPROD_CAPTURE_BASELINE.checkpointRef) throw new Error('Capture session must be based on the sealed 0.6.58 checkpoint.');
  exactGitSha(checkpoint.sourceCommitSha, 'baseline.sourceCommitSha');
  exactSha256(checkpoint.archiveSha256, 'baseline.archiveSha256');
  exactSha256(checkpoint.sourceTreeSha256, 'baseline.sourceTreeSha256');

  const boundCheckpoint = Object.freeze({
    checkpointRef: checkpoint.checkpointRef,
    sourceCommitSha: checkpoint.sourceCommitSha.toLowerCase(),
    archiveSha256: checkpoint.archiveSha256.toLowerCase(),
    sourceTreeSha256: checkpoint.sourceTreeSha256.toLowerCase()
  });
  const invariantProgram = createCardanoPreprodInvariantEvidenceProgram({ checkpoint: boundCheckpoint });

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-capture-session-manifest.v2',
    network: 'preprod',
    sessionId: id,
    checkpoint: boundCheckpoint,
    invariantProgram,
    capturePlan,
    files: Object.freeze({
      evaluationRequest: 'ogmios-evaluation-request.json',
      acquiredTip: 'captures/acquired-tip.json',
      protocolParameters: 'captures/protocol-parameters.json',
      ogmiosEvaluation: 'captures/ogmios-evaluation.json',
      evidence: 'cardano-preprod-synchronized-evidence.json'
    }),
    readinessRules: Object.freeze({
      exactCheckpointBaselineRequired: true,
      oneAcquiredStableTipRequired: true,
      minimumIndependentProtocolParameterSources: 2,
      independentProtocolParameterConfirmationRequired: true,
      tipBracketedOgmiosEvaluationRequired: true,
      supplementalFixtureUtxoContextRequired: true,
      fullPhaseOneValidationClaimAuthorized: false,
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false
    }),
    purpose: 'Prepare and verify stable-tip Cardano Preprod script-evaluation evidence without claiming full phase-1 validity or authorizing wallet signing/submission.',
    authorityBoundary: 'This manifest coordinates public-Preprod evaluation evidence only. It cannot authorize or prove full phase-1 validity, wallet witnesses, transaction submission, live-value movement, inclusion/finality, recovery, deployment or connector promotion.'
  });

  return Object.freeze({ ...core, manifestSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodCaptureSessionManifest(manifest) {
  const errors = [];
  try {
    plainObject(manifest, 'manifest');
    if (manifest.schema !== 'omegavault.cardano.preprod-capture-session-manifest.v2') errors.push('Capture session manifest schema is not supported.');
    if (manifest.network !== 'preprod') errors.push('Capture session manifest must target Cardano Preprod.');

    const baseline = manifest.checkpoint ?? {};
    for (const [field, expected] of Object.entries(CARDANO_PREPROD_CAPTURE_BASELINE)) {
      if (baseline[field] !== expected) errors.push(`Checkpoint baseline mismatch for ${field}.`);
    }

    const invariantProgramCheck = verifyCardanoPreprodInvariantEvidenceProgram(manifest.invariantProgram, { expectedCheckpoint: baseline });
    errors.push(...invariantProgramCheck.errors);

    const planCheck = verifyCapturePlan(manifest.capturePlan);
    errors.push(...planCheck.errors);

    const digest = exactSha256(manifest.manifestSha256, 'manifest.manifestSha256');
    const recomputed = hashCardanoEvidence(withoutDigest(manifest, 'manifestSha256'));
    if (digest !== recomputed) errors.push('Capture session manifest self-digest mismatch.');

    if (manifest.readinessRules?.minimumIndependentProtocolParameterSources !== 2 ||
        manifest.readinessRules?.independentProtocolParameterConfirmationRequired !== true ||
        manifest.readinessRules?.tipBracketedOgmiosEvaluationRequired !== true ||
        manifest.readinessRules?.supplementalFixtureUtxoContextRequired !== true ||
        manifest.readinessRules?.fullPhaseOneValidationClaimAuthorized !== false) {
      errors.push('Capture session readiness/evidence boundaries were weakened.');
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
  protocolParameterSnapshot,
  ogmiosEvaluation,
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
    protocolParameterSnapshot,
    ogmiosEvaluation,
    safetyMarginPercent
  });

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-capture-session-result.v2',
    sessionId: manifest.sessionId,
    checkpoint: manifest.checkpoint,
    manifestSha256: manifest.manifestSha256,
    protocolParameterGate: Object.freeze({
      matching: parameterGate.matching,
      independentSourceCount: parameterGate.independentSourceCount,
      independentlyConfirmed: true
    }),
    synchronizedEvaluationReady: true,
    fullPhaseOneValidated: false,
    evidence,
    invariantEvidenceStatus: Object.freeze({
      programSha256: manifest.invariantProgram.programSha256,
      requiredEvidenceLevel: manifest.invariantProgram.requiredEvidenceLevel,
      completedInvariantIds: Object.freeze([]),
      lifecycleProgramComplete: false,
      supportClaimAuthorized: false
    }),
    nextLiveGate: 'final-transaction-construction-phase-one-wallet-signing-submission-and-finality-remain-separately-gated',
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false
    })
  });

  return Object.freeze({ ...core, resultSha256: hashCardanoEvidence(core) });
}
