import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { createFinalityObservation, DEFAULT_FINALITY_POLICIES } from '../src/chains/finality.js';
import {
  buildRecoveryEnvelopeArtifact,
  createRecoveryEnvelopePlan
} from '../src/chains/stellar/native-recovery.js';
import { createStellarRecoveryExecutionEvidence } from '../src/chains/stellar/execution-evidence.js';

const KP = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n));
const G = n => KP(n).publicKey();

function fixture() {
  const plan = createRecoveryEnvelopePlan({
    vaultAccount: G(1),
    rescueDestination: G(2),
    currentSequence: '1000',
    inactivitySeconds: 2592000,
    contacts: [G(3), G(4)],
    threshold: 2,
    assets: ['native', { code: 'USDC', issuer: G(6) }],
    amounts: { native: '10', [`USDC:${G(6)}`]: '20.5' }
  });
  const artifact = buildRecoveryEnvelopeArtifact(plan);
  const transaction = TransactionBuilder.fromXdr(artifact.transactionXdr, plan.networkPassphrase);
  transaction.sign(KP(3), KP(4));
  const accountSnapshot = {
    sequence: '1001',
    masterWeight: 1,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ type: 'preAuthTx', key: artifact.preAuthTxSigner, weight: 1 }]
  };
  const finalityObservation = createFinalityObservation({
    policy: DEFAULT_FINALITY_POLICIES.stellarTestnet,
    transactionRef: artifact.transactionHashHex,
    observedAt: '2026-10-04T17:00:00.000Z',
    status: 'finalized',
    evidence: { ledger: 123456, transactionHash: artifact.transactionHashHex }
  });
  return {
    plan,
    artifact,
    signedTransactionXdr: transaction.toXdr(),
    accountSnapshot,
    submission: { includedInLedger: true, successful: true, resultCode: 'txSUCCESS' },
    finalityObservation
  };
}

test('Stellar recovery execution evidence binds signed envelope, preflight, submission and finalized ledger result', () => {
  const input = fixture();
  const result = createStellarRecoveryExecutionEvidence(input);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.status, 'verified');
  assert.equal(result.evidence.schema, 'omegavault.stellar-recovery-execution-evidence.v1');
  assert.equal(result.evidence.transactionHashHex, input.artifact.transactionHashHex);
  assert.equal(result.evidence.signatureCount, 2);
  assert.deepEqual(result.evidence.verifiedContactSigners, [G(3), G(4)]);
  assert.equal(result.evidence.preflight.ready, true);
  assert.equal(result.evidence.submission.preAuthSignerConsumed, true);
  assert.equal(result.evidence.finality.evidence.ledger, 123456);
  assert.match(result.evidence.signedEnvelopeSha256, /^[0-9a-f]{64}$/);
  assert.match(result.evidence.preflight.snapshotSha256, /^[0-9a-f]{64}$/);
  assert.match(result.evidence.sha256, /^[0-9a-f]{64}$/);

  const replay = createStellarRecoveryExecutionEvidence(fixture());
  assert.equal(replay.evidence.sha256, result.evidence.sha256);
});

test('Stellar recovery execution evidence fails closed on missing contact signature', () => {
  const input = fixture();
  const transaction = TransactionBuilder.fromXdr(input.artifact.transactionXdr, input.plan.networkPassphrase);
  transaction.sign(KP(3));
  const result = createStellarRecoveryExecutionEvidence({
    ...input,
    signedTransactionXdr: transaction.toXdr()
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.signedEnvelopeValid, false);
  assert.equal(result.evidence.status, 'rejected');
});

test('Stellar recovery execution evidence fails closed on account policy drift or substituted finality hash', () => {
  const input = fixture();
  const drifted = createStellarRecoveryExecutionEvidence({
    ...input,
    accountSnapshot: { ...input.accountSnapshot, masterWeight: 0 }
  });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.checks.accountPreflightReady, false);

  const substituted = createStellarRecoveryExecutionEvidence({
    ...input,
    finalityObservation: {
      ...input.finalityObservation,
      transactionRef: '11'.repeat(32),
      evidence: { ...input.finalityObservation.evidence, transactionHash: '11'.repeat(32) }
    }
  });
  assert.equal(substituted.ok, false);
  assert.equal(substituted.checks.finalityTransactionRefMatches, false);
  assert.equal(substituted.checks.finalityEvidenceHashMatches, false);
});

test('Stellar recovery execution evidence records applied failure as consumed and never verifies success', () => {
  const input = fixture();
  const result = createStellarRecoveryExecutionEvidence({
    ...input,
    submission: { includedInLedger: true, successful: false, resultCode: 'txFAILED' },
    finalityObservation: { ...input.finalityObservation, status: 'failed' }
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.submissionSuccessful, false);
  assert.equal(result.checks.finalityFinalized, false);
  assert.equal(result.evidence.submission.preAuthSignerConsumed, true);
  assert.equal(result.evidence.submission.retrySameEnvelope, false);
});

test('Stellar execution evidence rejects falsely successful submissions with failed result codes', () => {
  for (const resultCode of ['txFAILED', 'txBAD_SEQ', 'txINSUFFICIENT_BALANCE']) {
    const input = fixture();
    const result = createStellarRecoveryExecutionEvidence({
      ...input,
      submission: { includedInLedger: true, successful: true, resultCode }
    });
    assert.equal(result.ok, false, resultCode);
    assert.equal(result.checks.submissionResultCodeMatchesOutcome, false, resultCode);
    assert.equal(result.evidence.status, 'rejected');
  }
});

test('Stellar execution evidence rejects failed outcome masked by a success result code', () => {
  const input = fixture();
  const result = createStellarRecoveryExecutionEvidence({
    ...input,
    submission: { includedInLedger: true, successful: false, resultCode: 'txSUCCESS' },
    finalityObservation: { ...input.finalityObservation, status: 'failed' }
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.submissionResultCodeMatchesOutcome, false);
  assert.equal(result.evidence.submission.preAuthSignerConsumed, true);
  assert.equal(result.evidence.submission.retrySameEnvelope, false);
});

test('Stellar execution evidence preserves valid canonical success and fee-bump success codes', () => {
  const input = fixture();
  for (const code of ['txSUCCESS', 'txFEE_BUMP_INNER_SUCCESS']) {
    const result = createStellarRecoveryExecutionEvidence({
      ...input,
      submission: { includedInLedger: true, successful: true, resultCode: code }
    });
    assert.equal(result.ok, true, code);
    assert.equal(result.checks.submissionResultCodeMatchesOutcome, true);
  }
});
