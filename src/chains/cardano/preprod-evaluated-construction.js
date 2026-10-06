import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from './evidence-binding.js';
import { buildCardanoPreprodEvaluatedUnsignedFixture } from './witness-set.js';

const UINT = /^\d+$/;

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function positiveIntegerString(value, label) {
  const normalized = String(value);
  if (!UINT.test(normalized) || BigInt(normalized) < 1n) throw new TypeError(`${label} must be a positive integer.`);
  return normalized;
}

function budgetOverridesFromEvidence(evaluation, expectedValidators) {
  if (!Array.isArray(evaluation?.budgets)) throw new TypeError('Synchronized evaluation budgets are required.');
  if (!Array.isArray(expectedValidators) || expectedValidators.length < 1) throw new TypeError('Expected validator pointers are required.');
  const expected = new Set(expectedValidators);
  const result = {};
  for (const [index, entry] of evaluation.budgets.entries()) {
    const validator = typeof entry?.validator === 'string' ? entry.validator : '';
    if (!expected.has(validator)) throw new Error(`Unexpected evaluated validator pointer at budget ${index}.`);
    if (Object.hasOwn(result, validator)) throw new Error(`Duplicate evaluated validator pointer: ${validator}.`);
    result[validator] = Object.freeze({
      memory: positiveIntegerString(entry?.budget?.memory, `${validator}.budget.memory`),
      steps: positiveIntegerString(entry?.budget?.steps, `${validator}.budget.steps`)
    });
  }
  const missing = expectedValidators.filter(pointer => !Object.hasOwn(result, pointer));
  if (missing.length) throw new Error(`Missing evaluated validator budgets: ${missing.join(', ')}.`);
  return Object.freeze(result);
}

function evaluationSlotFromCandidate(transactionCborHex) {
  const transaction = Cardano.Transaction.from_hex(transactionCborHex);
  const lower = transaction.body().validity_start_interval_bignum();
  if (!lower) throw new Error('Evaluated transaction is missing a finite validity-start slot.');
  const lowerSlot = Number(lower.to_str());
  if (!Number.isSafeInteger(lowerSlot) || lowerSlot < 0) throw new Error('Evaluated transaction validity-start slot is invalid.');
  return lowerSlot + 30;
}

function withoutDigest(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'constructionSha256'));
}

export function createCardanoPreprodEvaluatedUnsignedConstruction({
  capturePlan,
  evaluationEvidence,
  parameters,
  recoveryCompiledCode,
  beaconCompiledCode
}) {
  const plan = plainObject(capturePlan, 'capturePlan');
  const evidence = plainObject(evaluationEvidence, 'evaluationEvidence');

  if (plan.schema !== 'omegavault.cardano.preprod-evidence-capture-plan.v2' || plan.network !== 'preprod') {
    throw new Error('A Cardano Preprod v2 capture plan is required.');
  }
  if (evidence.schema !== 'omegavault.cardano.preprod-synchronized-evaluation-evidence.v2' || evidence.network !== 'preprod') {
    throw new Error('Synchronized Cardano Preprod evaluation evidence is required.');
  }
  if (evidence.action !== plan.action || evidence.planSha256 !== plan.planSha256) {
    throw new Error('Cardano evaluated construction evidence is cross-wired to a different capture plan.');
  }
  if (evidence.transactionBodyHash !== plan.transactionBodyHash) {
    throw new Error('Cardano evaluated construction evidence is bound to a different transaction body.');
  }
  if (evidence.validationState?.synchronizedPublicPreprodEvaluationComplete !== true ||
      evidence.validationState?.fullPhaseOneValidated !== false ||
      evidence.liveActions?.walletSigningAuthorized !== false ||
      evidence.liveActions?.transactionSubmissionAuthorized !== false) {
    throw new Error('Cardano evaluated construction requires evaluation-only evidence with phase-1/signing/submission gates still closed.');
  }
  if (plan.evaluationContext?.syntheticSupplementalUtxoContext !== true ||
      plan.evaluationContext?.fullPhaseOneValidationPerformed !== false) {
    throw new Error('Cardano evaluated construction currently requires the explicit synthetic supplemental UTxO evaluation context.');
  }

  const budgetOverrides = budgetOverridesFromEvidence(evidence.evaluation, plan.expectedValidators);
  const evaluationSlot = evaluationSlotFromCandidate(plan.transactionCborHex);
  const candidate = buildCardanoPreprodEvaluatedUnsignedFixture({
    action: plan.action,
    parameters,
    recoveryCompiledCode,
    beaconCompiledCode,
    evaluationSlot,
    budgetOverrides
  });

  if (candidate.keyWitnessCount !== 0 || candidate.syntheticSizingWitnessesExcludedFromCandidate !== true) {
    throw new Error('Evaluated unsigned construction must exclude synthetic sizing witnesses from the candidate.');
  }
  if (candidate.executionUnitsFromLiveEvaluation !== true || candidate.requiresIndependentLiveEvaluation !== false) {
    throw new Error('Evaluated unsigned construction did not bind the live evaluation budgets.');
  }

  const tx = Cardano.Transaction.from_hex(candidate.transactionCborHex);
  const bodyHashHex = Buffer.from(blake2b(tx.body().to_bytes(), { dkLen: 32 })).toString('hex');
  const candidateCborSha256 = createHash('sha256').update(Buffer.from(candidate.transactionCborHex, 'hex')).digest('hex');

  const core = Object.freeze({
    schema: 'omegavault.cardano.preprod-evaluated-unsigned-construction.v1',
    network: 'preprod',
    action: plan.action,
    sourceEvaluationEvidenceSha256: evidence.evidenceSha256,
    sourcePlanSha256: plan.planSha256,
    sourceEvaluationTransactionBodyHash: plan.transactionBodyHash,
    evaluatedBudgets: budgetOverrides,
    evaluationSlot,
    candidate: Object.freeze({
      transactionBodyHash: bodyHashHex,
      transactionCborHex: candidate.transactionCborHex,
      transactionCborSha256: candidateCborSha256,
      transactionBytes: candidate.transactionBytes,
      feeSizingTransactionBytes: candidate.feeSizingTransactionBytes,
      minimumFee: candidate.minimumFee,
      executionMemory: candidate.memory,
      executionSteps: candidate.steps,
      scriptDataHash: candidate.scriptDataHash,
      minimumAda: candidate.minimumAda,
      collateral: candidate.collateral,
      candidateKeyWitnessCount: candidate.keyWitnessCount,
      feeSizingKeyWitnessCount: candidate.feeSizingKeyWitnessCount,
      syntheticSizingWitnessesExcludedFromCandidate: candidate.syntheticSizingWitnessesExcludedFromCandidate
    }),
    phaseOneBoundary: Object.freeze({
      synchronizedPublicPreprodEvaluationComplete: true,
      evaluatedUnsignedConstructionComplete: true,
      syntheticSupplementalUtxoContext: true,
      ledgerUtxoExistenceValidated: false,
      fullPhaseOneValidated: false,
      walletWitnessesValidated: false,
      transactionSubmitted: false,
      inclusionOrFinalityProven: false
    }),
    liveActions: Object.freeze({
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      liveValueMovementAuthorized: false,
      supportClaimAuthorized: false
    }),
    nextGate: 'replace-synthetic-utxo-context-with-real-preprod-inputs-and-complete-full-phase-one-validation-before-wallet-signing-or-submission',
    authorityBoundary: 'This construction binds live Ogmios execution budgets into an unsigned Cardano Preprod candidate and sizes the fee for the expected wallet witnesses. Synthetic sizing witnesses are excluded. It does not validate ledger UTxO existence, wallet signatures, full phase-1 rules, submission, inclusion/finality, recovery or connector promotion.'
  });

  return Object.freeze({ ...core, constructionSha256: hashCardanoEvidence(core) });
}

export function verifyCardanoPreprodEvaluatedUnsignedConstruction({
  construction,
  capturePlan,
  evaluationEvidence,
  parameters,
  recoveryCompiledCode,
  beaconCompiledCode
}) {
  if (!construction || typeof construction !== 'object' || Array.isArray(construction)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['Cardano evaluated unsigned construction is required.']), recomputedSha256: null });
  }
  const errors = [];
  let recomputed;
  try {
    recomputed = createCardanoPreprodEvaluatedUnsignedConstruction({
      capturePlan,
      evaluationEvidence,
      parameters,
      recoveryCompiledCode,
      beaconCompiledCode
    });
  } catch (error) {
    return Object.freeze({ valid: false, errors: Object.freeze([error.message]), recomputedSha256: null });
  }
  if (construction.constructionSha256 !== recomputed.constructionSha256) errors.push('Cardano evaluated unsigned construction digest mismatch.');
  if (hashCardanoEvidence(withoutDigest(construction)) !== construction.constructionSha256) errors.push('Cardano evaluated unsigned construction self-digest mismatch.');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), recomputedSha256: recomputed.constructionSha256 });
}
