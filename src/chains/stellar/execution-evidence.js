import { createHash } from 'node:crypto';
import { DEFAULT_FINALITY_POLICIES } from '../finality.js';
import {
  assessRecoverySubmissionResult,
  validateRecoveryAccountSnapshot,
  verifySignedRecoveryEnvelopeArtifact
} from './native-recovery.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function digestText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeTransactionHash(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function submissionObservedAtMilliseconds(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString().slice(0, 19) !== value.slice(0, 19)) return NaN;
  return milliseconds;
}

function canonicalSubmissionLedger(value) {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  return /^[1-9]\d*$/.test(text) ? text : null;
}

function normalizeSnapshot(snapshot) {
  const signers = Array.isArray(snapshot?.signers)
    ? snapshot.signers.map(signer => Object.freeze({
        type: String(signer?.type ?? ''),
        key: String(signer?.key ?? ''),
        weight: signer?.weight ?? null
      }))
    : [];
  return Object.freeze({
    sequence: String(snapshot?.sequence ?? ''),
    masterWeight: snapshot?.masterWeight ?? null,
    thresholds: Object.freeze({
      low: snapshot?.thresholds?.low ?? null,
      medium: snapshot?.thresholds?.medium ?? null,
      high: snapshot?.thresholds?.high ?? null
    }),
    signers: Object.freeze(signers)
  });
}

export function createStellarRecoveryExecutionEvidence({
  plan,
  artifact,
  signedTransactionXdr,
  accountSnapshot,
  submission,
  finalityObservation
}) {
  if (plan?.chainId !== 'stellar' || plan?.networkRef !== 'stellar:testnet') {
    throw new TypeError('Stellar recovery execution evidence requires the stellar:testnet native recovery plan.');
  }
  if (typeof signedTransactionXdr !== 'string' || !signedTransactionXdr.trim()) {
    throw new TypeError('signedTransactionXdr is required.');
  }
  if (!accountSnapshot || typeof accountSnapshot !== 'object' || Array.isArray(accountSnapshot)) {
    throw new TypeError('accountSnapshot is required.');
  }
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
    throw new TypeError('submission is required.');
  }
  if (!finalityObservation || typeof finalityObservation !== 'object' || Array.isArray(finalityObservation)) {
    throw new TypeError('finalityObservation is required.');
  }

  const expectedTransactionHash = normalizeTransactionHash(artifact?.transactionHashHex);
  if (!expectedTransactionHash) throw new TypeError('artifact.transactionHashHex must be a 32-byte hexadecimal transaction hash.');

  const signed = verifySignedRecoveryEnvelopeArtifact({ plan, artifact, signedTransactionXdr });
  const preflight = validateRecoveryAccountSnapshot({ plan, artifact, snapshot: accountSnapshot });
  const assessedSubmission = assessRecoverySubmissionResult(submission);
  const policy = DEFAULT_FINALITY_POLICIES.stellarTestnet;
  const finalityTransactionRef = normalizeTransactionHash(finalityObservation.transactionRef);
  const finalityEvidenceHash = normalizeTransactionHash(finalityObservation?.evidence?.transactionHash);
  const ledger = finalityObservation?.evidence?.ledger;
  const ledgerPresent = Number.isSafeInteger(ledger) && ledger > 0;
  const reportedSubmissionHash = normalizeTransactionHash(submission.transactionHashHex);
  const reportedInnerHash = normalizeTransactionHash(submission.innerTransactionHashHex);
  const feeBumpSuccess = assessedSubmission.resultCode === 'txFEE_BUMP_INNER_SUCCESS';
  // A fee-bump has a distinct outer hash; the inner hash identifies the
  // exact signed recovery envelope. Both must be bound to the observation.
  const submissionIdentityMatches = feeBumpSuccess
    ? reportedSubmissionHash !== null &&
      reportedSubmissionHash !== expectedTransactionHash &&
      reportedInnerHash === expectedTransactionHash
    : reportedSubmissionHash === expectedTransactionHash;
  // Horizon finalizes the fee-bump *outer* transaction. The signed recovery
  // envelope is the inner transaction, whose hash must match the artifact.
  // Requiring finality of the inner hash alone can accept a substituted
  // observation that never proves inclusion of the submitted outer envelope.
  const expectedFinalityHash = feeBumpSuccess ? reportedSubmissionHash : expectedTransactionHash;
  const submissionLedger = canonicalSubmissionLedger(submission.ledger);
  const submissionTime = submissionObservedAtMilliseconds(submission.observedAt);
  const finalityTime = submissionObservedAtMilliseconds(finalityObservation.observedAt);

  const checks = Object.freeze({
    signedEnvelopeValid: signed.valid === true,
    accountPreflightReady: preflight.ready === true,
    submissionIncluded: submission.includedInLedger === true,
    submissionSuccessful: submission.successful === true,
    submissionTransactionIdentityMatches: submissionIdentityMatches,
    submissionLedgerMatchesFinality: ledgerPresent && submissionLedger === String(ledger),
    submissionPrecedesFinality: Number.isFinite(submissionTime) &&
      Number.isFinite(finalityTime) && submissionTime <= finalityTime,
    // A success flag alone must never override a contradictory Horizon
    // transaction result code. An applied failure can consume preAuthTx.
    submissionResultCodeMatchesOutcome: submission.successful === true
      ? assessedSubmission.resultCode === 'txSUCCESS' ||
        assessedSubmission.resultCode === 'txFEE_BUMP_INNER_SUCCESS'
      : assessedSubmission.resultCode !== 'txSUCCESS' &&
        assessedSubmission.resultCode !== 'txFEE_BUMP_INNER_SUCCESS',
    finalityChainMatches: finalityObservation.chainId === policy.chainId,
    finalityNetworkMatches: finalityObservation.networkRef === policy.networkRef,
    finalityModelMatches: finalityObservation.model === policy.model,
    finalityFinalized: finalityObservation.status === 'finalized',
    finalityTransactionRefMatches: expectedFinalityHash !== null &&
      finalityTransactionRef === expectedFinalityHash,
    finalityEvidenceHashMatches: expectedFinalityHash !== null &&
      finalityEvidenceHash === expectedFinalityHash,
    finalityLedgerPresent: ledgerPresent
  });
  const ok = Object.values(checks).every(Boolean);
  const snapshot = normalizeSnapshot(accountSnapshot);
  const finalityEvidence = structuredClone(finalityObservation.evidence ?? {});

  const core = Object.freeze({
    schema: 'omegavault.stellar-recovery-execution-evidence.v1',
    chainId: plan.chainId,
    networkRef: plan.networkRef,
    strategy: plan.strategy,
    transactionHashHex: expectedTransactionHash,
    finalizedTransactionHashHex: expectedFinalityHash,
    preAuthTxSigner: artifact.preAuthTxSigner,
    signedEnvelopeSha256: digestText(signedTransactionXdr),
    signatureCount: signed.signatureCount,
    verifiedContactSigners: Object.freeze([...signed.verifiedContactSigners]),
    preflight: Object.freeze({
      snapshot,
      snapshotSha256: digest(snapshot),
      ready: preflight.ready,
      errors: Object.freeze([...preflight.errors])
    }),
    submission: Object.freeze({
      includedInLedger: submission.includedInLedger,
      successful: submission.successful,
      resultCode: assessedSubmission.resultCode,
      transactionHashHex: reportedSubmissionHash,
      innerTransactionHashHex: reportedInnerHash,
      ledger: submissionLedger,
      observedAt: submission.observedAt ?? null,
      preAuthSignerConsumed: assessedSubmission.preAuthSignerConsumed,
      retrySameEnvelope: assessedSubmission.retrySameEnvelope,
      action: assessedSubmission.action
    }),
    finality: Object.freeze({
      transactionRef: finalityObservation.transactionRef ?? null,
      observedAt: finalityObservation.observedAt ?? null,
      status: finalityObservation.status ?? null,
      model: finalityObservation.model ?? null,
      evidence: Object.freeze(finalityEvidence)
    }),
    checks,
    status: ok ? 'verified' : 'rejected',
    authorityBoundary: 'This artifact records supplied execution observations only. It does not authorize signing, transaction submission, chain promotion, production deployment, secret handling or wallet authority.'
  });

  return Object.freeze({
    ok,
    checks,
    evidence: Object.freeze({ ...core, sha256: digest(core) })
  });
}
