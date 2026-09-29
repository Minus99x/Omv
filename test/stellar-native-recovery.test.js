import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import {
  assessRecoverySubmissionResult,
  buildRecoveryEnvelopeArtifact,
  chooseRecoverySequence,
  coordinateRecoverySigners,
  createClassicAssetPreflight,
  createFeeBumpSponsorPlan,
  createHeartbeatPlan,
  createRecoveryEnvelopePlan,
  createSignerSetupPlan,
  estimateReserveImpact,
  validateRecoveryAccountSnapshot,
  verifyRecoveryEnvelopeArtifact
} from '../src/chains/stellar/native-recovery.js';

const G = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n)).publicKey();

function recoveryPlan() {
  return createRecoveryEnvelopePlan({
    vaultAccount: G(1), rescueDestination: G(2), currentSequence: '1000', inactivitySeconds: 2592000,
    contacts: [G(3), G(4)], threshold: 2,
    assets: ['native', { code: 'USDC', issuer: G(6) }],
    amounts: { native: '10', [`USDC:${G(6)}`]: '20.5' }
  });
}

test('Stellar future recovery sequence remains valid across many heartbeat sequence changes', () => {
  const plan = chooseRecoverySequence({ currentSequence: '1000', gap: 100000n });
  assert.equal(plan.minAccountSequence, '1000');
  assert.equal(plan.recoverySequence, '101000');
  assert.ok(BigInt(plan.recoverySequence) > 50000n);
});

test('Stellar heartbeat changes sequence and thereby resets sequence-age liveness', () => {
  const heartbeat = createHeartbeatPlan({ vaultAccount: G(1), currentSequence: '1000' });
  assert.equal(heartbeat.transactionSequence, '1001');
  assert.equal(heartbeat.operations[0].bumpTo, '1002');
  assert.match(heartbeat.livenessEffect, /resets/i);
});

test('Stellar recovery envelope fixes rescue operations and documents bounded asset semantics', () => {
  const plan = createRecoveryEnvelopePlan({
    vaultAccount: G(1), rescueDestination: G(2), currentSequence: '1000', inactivitySeconds: 2592000,
    contacts: [G(3), G(4)], threshold: 2,
    assets: ['native', { code: 'USDC', issuer: G(5) }],
    amounts: { native: '10.0000000', [`USDC:${G(5)}`]: '20.5' }
  });
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations.every(op => op.destination === G(2)), true);
  assert.equal(plan.preconditions.minAccountSequenceAge, '2592000');
  assert.equal(plan.signerPolicy.operationThreshold, 1);
  assert.equal(plan.signerPolicy.masterWeight, 1);
  assert.equal(plan.operations[1].amount, '20.5000000');
  assert.ok(plan.limitations.some(x => /immutable/i.test(x)));
});

test('Stellar fee bump separates fee payer without altering the inner transaction', () => {
  const plan = createFeeBumpSponsorPlan({ feeAccount: G(7), innerEnvelopeHash: 'ab'.repeat(32), maxFeeStroops: '10000' });
  assert.equal(plan.mode, 'fee-bump');
  assert.match(plan.authorizationBoundary, /cannot alter/i);
});

test('Stellar reserve calculator treats signers and trustlines as subentries and supports sponsorship', () => {
  const reserve = estimateReserveImpact({ baseReserveStroops: '5000000', existingSubentries: 1, addedSigners: 3, addedTrustlines: 1, sponsoredEntries: 2 });
  assert.equal(reserve.minimumBeforeStroops, '15000000');
  assert.equal(reserve.minimumAfterUnsponsoredStroops, '35000000');
  assert.equal(reserve.minimumAfterBeneficiarySponsorshipStroops, '25000000');
});

test('Stellar classic-asset preflight rejects missing rescue trustline or insufficient capacity', () => {
  const asset = { code: 'USDC', issuer: G(6) };
  const blocked = createClassicAssetPreflight({ asset, vaultTrustline: { exists: true }, rescueTrustline: { exists: false }, vaultBalance: '100', paymentAmount: '25' });
  assert.equal(blocked.ready, false);
  const ready = createClassicAssetPreflight({ asset, vaultTrustline: { exists: true }, rescueTrustline: { exists: true, authorized: true, limit: '1000', balance: '10' }, vaultBalance: '100', paymentAmount: '25' });
  assert.equal(ready.ready, true);
});

test('Stellar account validation rejects shape-only keys with invalid checksums', () => {
  assert.throws(() => createHeartbeatPlan({ vaultAccount: `G${'A'.repeat(55)}`, currentSequence: '1' }), /valid Stellar account/);
  assert.throws(() => createRecoveryEnvelopePlan({
    vaultAccount: G(1), rescueDestination: G(2), currentSequence: '1', inactivitySeconds: 60,
    contacts: [G(3), G(3)], threshold: 1, amounts: { native: '1' }
  }), /unique/);
});

test('pinned Stellar SDK builds and round-trips the exact recovery XDR', () => {
  const plan = recoveryPlan();
  const artifact = buildRecoveryEnvelopeArtifact(plan);
  assert.equal(artifact.sdk.package, '@stellar/stellar-sdk');
  assert.equal(artifact.sdk.version, '17.1.0');
  assert.equal(artifact.transactionSequence, plan.sequence.recoverySequence);
  assert.equal(artifact.minAccountSequenceAge, '2592000');
  assert.equal(artifact.operationCount, 2);
  assert.equal(artifact.totalFeeStroops, '200');
  assert.equal(artifact.transactionHashHex, '32bf2e38816f6f50b5f765593f38e4effe9f07f8224dfa948eaf42005afa0917');
  assert.equal(artifact.preAuthTxSigner, 'TAZL6LRYQFXW6UFV65SVSPZY4TX75HYH7ARE36UUR2XUEAC27IERPO27');
  assert.match(artifact.preAuthTxSigner, /^T[A-Z2-7]{55}$/);
  assert.equal(artifact.roundTripVerified, true);
  const verified = verifyRecoveryEnvelopeArtifact({ plan, artifact });
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('Stellar signer setup keeps contacts below threshold without the exact preAuthTx signer', () => {
  const plan = recoveryPlan();
  const artifact = buildRecoveryEnvelopeArtifact(plan);
  const setup = createSignerSetupPlan({ plan, transactionHashHex: artifact.transactionHashHex });
  assert.equal(setup.preAuthTxSigner, artifact.preAuthTxSigner);
  assert.equal(setup.operations.length, 2);
  assert.equal(plan.signerPolicy.contactAccountSignerWeight, 0);
  assert.deepEqual(plan.signerPolicy.requiredExtraSigners, [G(3), G(4)]);
  assert.equal(plan.signerPolicy.preAuthTxWeight, plan.signerPolicy.operationThreshold);
});

test('Stellar recovery coordinator selects exactly threshold contacts and rejects extras', () => {
  const plan = recoveryPlan();
  const coordinated = coordinateRecoverySigners({ plan, signerAccounts: [G(4), G(3)] });
  assert.deepEqual(coordinated.selectedSigners, [G(3), G(4)]);
  assert.equal(coordinated.totalAuthorizationWeight, coordinated.requiredThreshold);
  assert.throws(() => coordinateRecoverySigners({ plan, signerAccounts: [G(3), G(4), G(5)] }), /Unknown recovery signer/);
  assert.throws(() => coordinateRecoverySigners({ plan, signerAccounts: [G(3), G(8)] }), /Unknown recovery signer/);
  assert.throws(() => coordinateRecoverySigners({ plan, signerAccounts: [G(3), G(3)] }), /Duplicate/);
});

test('Stellar account snapshot preflight fails closed on signer removal or policy drift', () => {
  const plan = recoveryPlan();
  const artifact = buildRecoveryEnvelopeArtifact(plan);
  const snapshot = {
    sequence: '1001', masterWeight: 1, thresholds: { low: 1, medium: 1, high: 1 },
    signers: [
      { type: 'preAuthTx', key: artifact.preAuthTxSigner, weight: 1 }
    ]
  };
  assert.equal(validateRecoveryAccountSnapshot({ plan, artifact, snapshot }).ready, true);
  const removed = { ...snapshot, signers: snapshot.signers.filter(signer => signer.type !== 'preAuthTx') };
  const result = validateRecoveryAccountSnapshot({ plan, artifact, snapshot: removed });
  assert.equal(result.ready, false);
  assert.ok(result.errors.some(error => /pre-authorized/i.test(error)));
});

test('native Stellar exact mode rejects unsupported M-of-N policies instead of weakening semantics', () => {
  assert.throws(() => createRecoveryEnvelopePlan({
    vaultAccount: G(1), rescueDestination: G(2), currentSequence: '1000', inactivitySeconds: 60,
    contacts: [G(3), G(4)], threshold: 1, amounts: { native: '1' }
  }), /N-of-N/);
  assert.throws(() => createRecoveryEnvelopePlan({
    vaultAccount: G(1), rescueDestination: G(2), currentSequence: '1000', inactivitySeconds: 60,
    contacts: [G(3), G(4), G(5)], threshold: 3, amounts: { native: '1' }
  }), /at most two extra signers/);
});

test('an applied failed recovery consumes the one-time signer and requires a rebuild', () => {
  const failed = assessRecoverySubmissionResult({ includedInLedger: true, successful: false, resultCode: 'txFAILED' });
  assert.equal(failed.preAuthSignerConsumed, true);
  assert.equal(failed.retrySameEnvelope, false);
  assert.match(failed.action, /rebuild/i);
  const rejected = assessRecoverySubmissionResult({ includedInLedger: false, successful: false, resultCode: 'txBAD_SEQ' });
  assert.equal(rejected.preAuthSignerConsumed, false);
  assert.match(rejected.action, /preflight/i);
});
