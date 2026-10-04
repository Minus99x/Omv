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
  const normalized = String(value ?? '').trim().replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
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

  const checks = Object.freeze({
    signedEnvelopeValid: signed.valid === true,
    accountPreflightReady: preflight.ready === true,
    submissionIncluded: submission.includedInLedger === true,
    submissionSuccessful: submission.successful === true,
    finalityChainMatches: finalityObservation.chainId === policy.chainId,
    finalityNetworkMatches: finalityObservation.networkRef === policy.networkRef,
    finalityModelMatches: finalityObservation.model === policy.model,
    finalityFinalized: finalityObservation.status === 'finalized',
    finalityTransactionRefMatches: finalityTransactionRef === expectedTransactionHash,
    finalityEvidenceHashMatches: finalityEvidenceHash === expectedTransactionHash,
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
