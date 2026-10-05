import { createHash } from 'node:crypto';
import { createCardanoSynchronizedEvaluationBundle, hashCardanoEvidence } from './evidence-binding.js';
import {
  createCardanoOgmiosEvaluationRequest,
  normalizeCardanoOgmiosEvaluation
} from './ogmios-evaluation.js';
import { normalizeCardanoProtocolParameterSnapshot } from './protocol-parameters.js';

const HEX_32 = /^[0-9a-f]{64}$/i;
const HEX = /^(?:[0-9a-f]{2})+$/i;

function hex32(value, label) {
  if (typeof value !== 'string' || !HEX_32.test(value)) throw new TypeError(`${label} must be 32-byte hex.`);
  return value.toLowerCase();
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function sha256HexBytes(value) {
  return createHash('sha256').update(Buffer.from(value, 'hex')).digest('hex');
}

function assertSameTip(expected, value, label) {
  const normalized = hex32(value, label);
  if (normalized !== expected) throw new Error(`${label} is not bound to the acquired Cardano Preprod tip.`);
  return normalized;
}

export function createCardanoPreprodEvidenceCapturePlan({
  action,
  transactionCborHex,
  additionalUtxoSet,
  requestId,
  captureLabel = 'omegavault-cardano-preprod'
}) {
  if (!['initialize', 'heartbeat', 'approve', 'execute'].includes(action)) throw new TypeError('action must be initialize, heartbeat, approve, or execute.');
  if (typeof transactionCborHex !== 'string' || !HEX.test(transactionCborHex)) throw new TypeError('transactionCborHex must be non-empty base16 CBOR.');
  if (!Array.isArray(additionalUtxoSet) || additionalUtxoSet.length < 1) {
    throw new TypeError('additionalUtxoSet is required for the offline fixture evaluation context.');
  }
  const label = text(captureLabel, 'captureLabel');
  const id = requestId ?? `${label}-${action}-evaluate`;
  const evaluation = createCardanoOgmiosEvaluationRequest({ transactionCborHex, additionalUtxoSet, id });

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-evidence-capture-plan.v2',
    network: 'preprod',
    action,
    captureLabel: label,
    transactionBodyHash: evaluation.transactionBodyHash,
    transactionCborHex: transactionCborHex.toLowerCase(),
    transactionCborSha256: sha256HexBytes(transactionCborHex),
    evaluationRequest: evaluation.request,
    evaluationContext: Object.freeze({
      supplementalUtxoSha256: hashCardanoEvidence(additionalUtxoSet),
      syntheticSupplementalUtxoContext: true,
      keyWitnessesRequiredForEvaluation: false,
      fullPhaseOneValidationPerformed: false
    }),
    expectedValidators: Object.freeze([...evaluation.expectedValidators]),
    requiredCaptures: Object.freeze([
      'acquired-stable-tip',
      'same-tip-current-protocol-parameters-with-independent-confirmation',
      'tip-bracketed-ogmios-evaluation-response'
    ]),
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false
    }),
    authorityBoundary: 'This plan proves public-Preprod script evaluation only. The evaluation candidate is unsigned and uses an explicit supplemental fixture UTxO context. Full phase-1 validation, wallet witnesses, submission, inclusion, finality, recovery and support promotion remain separate later gates.'
  });

  return Object.freeze({ ...core, planSha256: hashCardanoEvidence(core) });
}

export function createCardanoPreprodSynchronizedEvaluationEvidence({
  plan,
  acquiredTip,
  protocolParameterSnapshot,
  ogmiosEvaluation,
  safetyMarginPercent = 10
}) {
  plainObject(plan, 'plan');
  if (plan.schema !== 'omegavault.cardano.preprod-evidence-capture-plan.v2' || plan.network !== 'preprod') {
    throw new TypeError('A Cardano Preprod v2 evidence capture plan is required.');
  }
  const tip = plainObject(acquiredTip, 'acquiredTip');
  const tipHash = hex32(tip.hash, 'acquiredTip.hash');
  if (!Number.isInteger(tip.epoch) || tip.epoch < 0) throw new TypeError('acquiredTip.epoch must be a non-negative integer.');

  const protocol = plainObject(protocolParameterSnapshot, 'protocolParameterSnapshot');
  assertSameTip(tipHash, protocol?.tip?.blockHash, 'protocolParameterSnapshot.tip.blockHash');
  if (protocol?.tip?.epoch !== tip.epoch) throw new Error('Protocol-parameter epoch does not match the acquired tip epoch.');
  const normalizedParameters = normalizeCardanoProtocolParameterSnapshot(protocol);
  if (!normalizedParameters.independentlyConfirmed || normalizedParameters.sourceCount < 2) {
    throw new Error('Current Cardano Preprod protocol parameters require at least two independent confirming sources.');
  }

  const capturedEvaluation = plainObject(ogmiosEvaluation, 'ogmiosEvaluation');
  const tipBeforeHash = assertSameTip(tipHash, capturedEvaluation.tipBeforeHash, 'ogmiosEvaluation.tipBeforeHash');
  const tipAfterHash = assertSameTip(tipHash, capturedEvaluation.tipAfterHash, 'ogmiosEvaluation.tipAfterHash');
  if (tipBeforeHash !== tipAfterHash) throw new Error('Ogmios evaluation was not bracketed by one stable Preprod tip.');
  if (capturedEvaluation.syntheticSupplementalUtxoContext !== true) {
    throw new Error('Ogmios evaluation must explicitly declare the supplemental fixture UTxO context.');
  }
  if (capturedEvaluation.walletSigningPerformed !== false || capturedEvaluation.transactionSubmissionPerformed !== false) {
    throw new Error('Evaluation capture attempted to cross the no-signing/no-submission authority boundary.');
  }

  const evaluation = normalizeCardanoOgmiosEvaluation({
    response: capturedEvaluation.response,
    requestId: plan.evaluationRequest.id,
    expectedValidators: plan.expectedValidators,
    parameters: normalizedParameters,
    safetyMarginPercent
  });
  const boundEvaluation = Object.freeze({
    ...evaluation,
    transactionBodyHash: plan.transactionBodyHash,
    tipHash,
    tipBeforeHash,
    tipAfterHash
  });

  const synchronizedState = Object.freeze({
    acquiredTipHash: tipHash,
    protocolParametersTipHash: tipHash,
    evaluationTipBeforeHash: tipHash,
    evaluationTipAfterHash: tipHash,
    transactionBodyHash: plan.transactionBodyHash,
    evaluationTransactionBodyHash: plan.transactionBodyHash
  });

  const bundle = createCardanoSynchronizedEvaluationBundle({
    network: 'preprod',
    transactionBodyHash: plan.transactionBodyHash,
    transactionCborHex: plan.transactionCborHex,
    synchronizedState,
    protocolParameters: protocol,
    evaluation: boundEvaluation,
    evaluationRequest: plan.evaluationRequest
  });

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-synchronized-evaluation-evidence.v2',
    network: 'preprod',
    action: plan.action,
    captureLabel: plan.captureLabel,
    planSha256: plan.planSha256,
    acquiredTip: Object.freeze({ hash: tipHash, epoch: tip.epoch, slot: tip.slot ?? null, blockHeight: tip.blockHeight ?? null }),
    transactionBodyHash: plan.transactionBodyHash,
    transactionCborSha256: plan.transactionCborSha256,
    evaluationContext: plan.evaluationContext,
    evaluation: boundEvaluation,
    evidenceBundle: bundle,
    validationState: Object.freeze({
      synchronizedPublicPreprodEvaluationComplete: true,
      fullPhaseOneValidated: false,
      walletWitnessesValidated: false,
      transactionSubmitted: false,
      inclusionOrFinalityProven: false
    }),
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false
    }),
    status: 'synchronized-public-preprod-evaluation-only',
    authorityBoundary: 'This evidence proves a stable-tip public-Preprod Ogmios evaluation of the exact unsigned candidate with its explicit supplemental fixture UTxO context. It does not prove full phase-1 validity, wallet witnesses, submission, inclusion, finality, recovery, deployment or connector promotion.'
  });
  return Object.freeze({ ...core, evidenceSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodSynchronizedEvaluationEvidence({ evidence, ...captureInputs }) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Cardano synchronized evaluation evidence is required.']), recomputedSha256: null });
  }
  const errors = [];
  let recomputed;
  try {
    recomputed = createCardanoPreprodSynchronizedEvaluationEvidence(captureInputs);
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([`Cardano synchronized evidence could not be reproduced: ${error.message}`]), recomputedSha256: null });
  }
  if (evidence.evidenceSha256 !== recomputed.evidenceSha256) errors.push('Cardano synchronized evaluation evidence digest mismatch.');
  if (hashCardanoEvidence(Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'evidenceSha256'))) !== evidence.evidenceSha256) {
    errors.push('Cardano synchronized evaluation evidence self-digest mismatch.');
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    recomputedSha256: recomputed.evidenceSha256
  });
}
