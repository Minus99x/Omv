import { createHash } from 'node:crypto';
import { createCardanoEvaluationEvidenceBundle, hashCardanoEvidence } from './evidence-binding.js';
import {
  createCardanoLedgerEvaluationGate,
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

function sha256HexBytes(hex) {
  return createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
}

function assertSameTip(expected, value, label) {
  const normalized = hex32(value, label);
  if (normalized !== expected) throw new Error(`${label} is not bound to the acquired Cardano Preprod tip.`);
  return normalized;
}

function phaseOnePassed(validation) {
  return validation?.passed === true &&
    validation?.balanced === true &&
    validation?.minimumAdaSatisfied === true &&
    validation?.collateralSatisfied === true &&
    validation?.witnessesSatisfied === true;
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
  const label = text(captureLabel, 'captureLabel');
  const id = requestId ?? `${label}-${action}-evaluate`;
  const evaluation = createCardanoOgmiosEvaluationRequest({ transactionCborHex, additionalUtxoSet, id });

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-evidence-capture-plan.v1',
    network: 'preprod',
    action,
    captureLabel: label,
    transactionBodyHash: evaluation.transactionBodyHash,
    transactionCborHex: transactionCborHex.toLowerCase(),
    transactionCborSha256: sha256HexBytes(transactionCborHex),
    evaluationRequest: evaluation.request,
    expectedValidators: Object.freeze([...evaluation.expectedValidators]),
    requiredCaptures: Object.freeze([
      'acquired-tip',
      'same-tip-utxo-snapshot',
      'same-tip-protocol-parameters',
      'same-tip-ogmios-evaluation-response',
      'independent-same-tip-phase-one-validation'
    ]),
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false
    }),
    authorityBoundary: 'This plan prepares evidence capture only. It cannot authorize wallet signing, transaction submission, live-value movement, deployment or connector promotion.'
  });

  return Object.freeze({ ...core, planSha256: hashCardanoEvidence(core) });
}

export function createCardanoPreprodSynchronizedEvaluationEvidence({
  plan,
  acquiredTip,
  utxoSnapshot,
  protocolParameterSnapshot,
  ogmiosEvaluation,
  phaseOneValidation,
  safetyMarginPercent = 10
}) {
  plainObject(plan, 'plan');
  if (plan.schema !== 'omegavault.cardano.preprod-evidence-capture-plan.v1' || plan.network !== 'preprod') {
    throw new TypeError('A Cardano Preprod evidence capture plan is required.');
  }
  const tip = plainObject(acquiredTip, 'acquiredTip');
  const tipHash = hex32(tip.hash, 'acquiredTip.hash');
  if (!Number.isInteger(tip.epoch) || tip.epoch < 0) throw new TypeError('acquiredTip.epoch must be a non-negative integer.');

  const utxo = plainObject(utxoSnapshot, 'utxoSnapshot');
  assertSameTip(tipHash, utxo.tipHash, 'utxoSnapshot.tipHash');

  const protocol = plainObject(protocolParameterSnapshot, 'protocolParameterSnapshot');
  assertSameTip(tipHash, protocol?.tip?.blockHash, 'protocolParameterSnapshot.tip.blockHash');
  if (protocol?.tip?.epoch !== tip.epoch) throw new Error('Protocol-parameter epoch does not match the acquired tip epoch.');
  const normalizedParameters = normalizeCardanoProtocolParameterSnapshot(protocol);

  const capturedEvaluation = plainObject(ogmiosEvaluation, 'ogmiosEvaluation');
  assertSameTip(tipHash, capturedEvaluation.tipHash, 'ogmiosEvaluation.tipHash');
  const evaluation = normalizeCardanoOgmiosEvaluation({
    response: capturedEvaluation.response,
    requestId: plan.evaluationRequest.id,
    expectedValidators: plan.expectedValidators,
    parameters: normalizedParameters,
    safetyMarginPercent
  });
  const boundEvaluation = Object.freeze({ ...evaluation, transactionBodyHash: plan.transactionBodyHash, tipHash });

  const phaseOne = plainObject(phaseOneValidation, 'phaseOneValidation');
  assertSameTip(tipHash, phaseOne.tipHash, 'phaseOneValidation.tipHash');
  if (phaseOne.independentOfOgmiosEvaluation !== true) throw new Error('Phase-1 validation must be independent of Ogmios execution-unit evaluation.');
  text(phaseOne.source, 'phaseOneValidation.source');
  if (!phaseOnePassed(phaseOne)) throw new Error('Independent Cardano phase-1 validation must pass completely.');
  if (hex32(phaseOne.transactionBodyHash, 'phaseOneValidation.transactionBodyHash') !== plan.transactionBodyHash) {
    throw new Error('Phase-1 validation is bound to a different Cardano transaction body.');
  }

  const synchronizedState = Object.freeze({
    acquiredTipHash: tipHash,
    protocolParametersTipHash: tipHash,
    utxoSnapshotTipHash: tipHash,
    evaluationTipHash: tipHash,
    phaseOneTipHash: tipHash,
    transactionBodyHash: plan.transactionBodyHash,
    evaluationTransactionBodyHash: plan.transactionBodyHash,
    phaseOneTransactionBodyHash: plan.transactionBodyHash
  });

  const ledgerGate = createCardanoLedgerEvaluationGate({
    evaluation: boundEvaluation,
    synchronizedState,
    phaseOneValidation: phaseOne
  });
  if (!ledgerGate.ready) throw new Error(ledgerGate.reason || 'Cardano synchronized evaluation gate is not ready.');

  const bundle = createCardanoEvaluationEvidenceBundle({
    network: 'preprod',
    transactionBodyHash: plan.transactionBodyHash,
    transactionCborHex: plan.transactionCborHex,
    synchronizedState,
    utxoSnapshot: utxo,
    protocolParameters: protocol,
    evaluation: boundEvaluation,
    phaseOneValidation: phaseOne
  });

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-synchronized-evaluation-evidence.v1',
    network: 'preprod',
    action: plan.action,
    captureLabel: plan.captureLabel,
    planSha256: plan.planSha256,
    acquiredTip: Object.freeze({ hash: tipHash, epoch: tip.epoch, slot: tip.slot ?? null, blockHeight: tip.blockHeight ?? null }),
    transactionBodyHash: plan.transactionBodyHash,
    transactionCborSha256: plan.transactionCborSha256,
    evaluation: boundEvaluation,
    phaseOneValidation: phaseOne,
    evidenceBundle: bundle,
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      publicNetworkRecoveryProven: false
    }),
    status: 'synchronized-evaluation-evidence-only',
    authorityBoundary: 'This evidence proves same-tip evaluation and independent phase-1 validation for the supplied transaction candidate only. It does not authorize or prove wallet signing, submission, inclusion, finality, recovery, deployment or connector promotion.'
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
