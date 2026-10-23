import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  assessRecoverySubmissionResult,
  buildFeeBumpEnvelopeArtifact,
  buildHeartbeatEnvelopeArtifact,
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
  verifyFeeBumpEnvelopeArtifact,
  verifyHeartbeatEnvelopeArtifact,
  verifyRecoveryEnvelopeArtifact,
  verifySignedFeeBumpEnvelopeArtifact,
  verifySignedHeartbeatEnvelopeArtifact,
  verifySignedRecoveryEnvelopeArtifact
} from '../src/chains/stellar/native-recovery.js';

const KP = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n));
const G = n => KP(n).publicKey();

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


test('Stellar signed recovery envelope verifies the exact configured contact signature set', () => {
  const plan = recoveryPlan();
  const artifact = buildRecoveryEnvelopeArtifact(plan);
  const signed = TransactionBuilder.fromXdr(artifact.transactionXdr, plan.networkPassphrase);
  signed.sign(KP(3), KP(4));
  const result = verifySignedRecoveryEnvelopeArtifact({
    plan,
    artifact,
    signedTransactionXdr:signed.toXdr()
  });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.exactSignatureSet, true);
  assert.equal(result.signatureCount, 2);
  assert.deepEqual(result.verifiedContactSigners, [G(3), G(4)]);
});

test('Stellar signed recovery verification rejects missing and extra signatures', () => {
  const plan = recoveryPlan();
  const artifact = buildRecoveryEnvelopeArtifact(plan);

  const missing = TransactionBuilder.fromXdr(artifact.transactionXdr, plan.networkPassphrase);
  missing.sign(KP(3));
  const missingResult = verifySignedRecoveryEnvelopeArtifact({
    plan, artifact, signedTransactionXdr:missing.toXdr()
  });
  assert.equal(missingResult.valid, false);
  assert.ok(missingResult.errors.some(error => /missing or invalid/i.test(error)));

  const extra = TransactionBuilder.fromXdr(artifact.transactionXdr, plan.networkPassphrase);
  extra.sign(KP(3), KP(4), KP(8));
  const extraResult = verifySignedRecoveryEnvelopeArtifact({
    plan, artifact, signedTransactionXdr:extra.toXdr()
  });
  assert.equal(extraResult.valid, false);
  assert.ok(extraResult.errors.some(error => /exactly 2 contact signature/i.test(error)));
  assert.ok(extraResult.errors.some(error => /unknown, duplicate or otherwise unapproved/i.test(error)));
});

test('Stellar signed recovery verification rejects a correctly signed substituted transaction', () => {
  const originalPlan = recoveryPlan();
  const originalArtifact = buildRecoveryEnvelopeArtifact(originalPlan);
  const substitutedPlan = createRecoveryEnvelopePlan({
    vaultAccount:G(1), rescueDestination:G(2), currentSequence:'1000', inactivitySeconds:2592000,
    contacts:[G(3), G(4)], threshold:2,
    assets:['native', { code:'USDC', issuer:G(6) }],
    amounts:{ native:'11', [`USDC:${G(6)}`]:'20.5' }
  });
  const substitutedArtifact = buildRecoveryEnvelopeArtifact(substitutedPlan);
  const signed = TransactionBuilder.fromXdr(substitutedArtifact.transactionXdr, substitutedPlan.networkPassphrase);
  signed.sign(KP(3), KP(4));

  const result = verifySignedRecoveryEnvelopeArtifact({
    plan:originalPlan,
    artifact:originalArtifact,
    signedTransactionXdr:signed.toXdr()
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => /hash does not match/i.test(error)));
});


test('Stellar heartbeat artifact round-trips the exact sequence bump', () => {
  const plan = createHeartbeatPlan({ vaultAccount:G(1), currentSequence:'1000' });
  const artifact = buildHeartbeatEnvelopeArtifact({ vaultAccount:G(1), currentSequence:'1000' });
  assert.equal(artifact.sourceAccount, G(1));
  assert.equal(artifact.transactionSequence, '1001');
  assert.equal(artifact.bumpTo, '1002');
  assert.equal(artifact.totalFeeStroops, '100');
  assert.equal(artifact.roundTripVerified, true);
  assert.match(artifact.transactionHashHex, /^[a-f0-9]{64}$/);
  const verified = verifyHeartbeatEnvelopeArtifact({ plan, artifact });
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('Stellar signed heartbeat requires exactly the vault owner signature', () => {
  const plan = createHeartbeatPlan({ vaultAccount:G(1), currentSequence:'1000' });
  const artifact = buildHeartbeatEnvelopeArtifact({ vaultAccount:G(1), currentSequence:'1000' });
  const signed = TransactionBuilder.fromXdr(artifact.transactionXdr, artifact.networkPassphrase);
  signed.sign(KP(1));
  const result = verifySignedHeartbeatEnvelopeArtifact({ plan, artifact, signedTransactionXdr:signed.toXdr() });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.ownerSignatureVerified, true);
  assert.equal(result.signatureCount, 1);
});

test('Stellar signed heartbeat rejects a wrong owner signature', () => {
  const plan = createHeartbeatPlan({ vaultAccount:G(1), currentSequence:'1000' });
  const artifact = buildHeartbeatEnvelopeArtifact({ vaultAccount:G(1), currentSequence:'1000' });
  const signed = TransactionBuilder.fromXdr(artifact.transactionXdr, artifact.networkPassphrase);
  signed.sign(KP(2));
  const result = verifySignedHeartbeatEnvelopeArtifact({ plan, artifact, signedTransactionXdr:signed.toXdr() });
  assert.equal(result.valid, false);
  assert.equal(result.ownerSignatureVerified, false);
  assert.ok(result.errors.some(error => /vault owner/i.test(error)));
});

test('Stellar signed heartbeat rejects extra signatures', () => {
  const plan = createHeartbeatPlan({ vaultAccount:G(1), currentSequence:'1000' });
  const artifact = buildHeartbeatEnvelopeArtifact({ vaultAccount:G(1), currentSequence:'1000' });
  const signed = TransactionBuilder.fromXdr(artifact.transactionXdr, artifact.networkPassphrase);
  signed.sign(KP(1), KP(2));
  const result = verifySignedHeartbeatEnvelopeArtifact({ plan, artifact, signedTransactionXdr:signed.toXdr() });
  assert.equal(result.valid, false);
  assert.equal(result.signatureCount, 2);
  assert.ok(result.errors.some(error => /exactly one owner signature/i.test(error)));
});


test('Stellar native recovery refuses network-passphrase drift away from Testnet', () => {
  const mainnetPassphrase = 'Public Global Stellar Network ; September 2015';
  assert.throws(() => createRecoveryEnvelopePlan({
    vaultAccount:G(1), rescueDestination:G(2), currentSequence:'1000', inactivitySeconds:60,
    contacts:[G(3), G(4)], threshold:2, amounts:{ native:'1' },
    networkPassphrase:mainnetPassphrase
  }), /testnet-only/i);

  assert.throws(() => buildHeartbeatEnvelopeArtifact({
    vaultAccount:G(1), currentSequence:'1000', networkPassphrase:mainnetPassphrase
  }), /testnet-only/i);

  const plan = recoveryPlan();
  const driftedPlan = structuredClone(plan);
  driftedPlan.networkPassphrase = mainnetPassphrase;
  assert.throws(() => buildRecoveryEnvelopeArtifact(driftedPlan), /restricted to the configured Stellar Testnet identity/i);

  const artifact = buildRecoveryEnvelopeArtifact(plan);
  const driftedArtifact = { ...artifact, networkPassphrase:mainnetPassphrase };
  const verified = verifyRecoveryEnvelopeArtifact({ plan, artifact:driftedArtifact });
  assert.equal(verified.valid, false);
  assert.ok(verified.errors.some(error => /network passphrase does not match/i.test(error)));
});


function signedRecoveryFixture() {
  const plan = recoveryPlan();
  const artifact = buildRecoveryEnvelopeArtifact(plan);
  const signed = TransactionBuilder.fromXdr(artifact.transactionXdr, plan.networkPassphrase);
  signed.sign(KP(3), KP(4));
  return { plan, artifact, signedRecoveryTransactionXdr:signed.toXdr() };
}

test('Stellar fee bump wraps the exact signed recovery envelope under a total-fee cap', () => {
  const recovery = signedRecoveryFixture();
  const feeBumpPlan = createFeeBumpSponsorPlan({
    feeAccount:G(7),
    innerEnvelopeHash:recovery.artifact.transactionHashHex,
    maxFeeStroops:'1000'
  });
  const artifact = buildFeeBumpEnvelopeArtifact({
    recoveryPlan:recovery.plan,
    recoveryArtifact:recovery.artifact,
    signedRecoveryTransactionXdr:recovery.signedRecoveryTransactionXdr,
    feeBumpPlan,
    baseFeeStroops:'200'
  });
  assert.equal(artifact.feeSource, G(7));
  assert.equal(artifact.innerTransactionHashHex, recovery.artifact.transactionHashHex);
  assert.equal(artifact.innerSignedTransactionXdr, recovery.signedRecoveryTransactionXdr);
  assert.equal(artifact.baseFeeStroops, '200');
  assert.equal(artifact.totalFeeStroops, '600');
  assert.equal(artifact.maxFeeStroops, '1000');
  assert.equal(artifact.outerSignatureCount, 0);
  assert.equal(artifact.innerRecoverySignaturesPreserved, true);
  const verified = verifyFeeBumpEnvelopeArtifact({
    recoveryPlan:recovery.plan,
    recoveryArtifact:recovery.artifact,
    feeBumpPlan,
    artifact
  });
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('Stellar signed fee bump requires exactly the configured fee-payer signature', () => {
  const recovery = signedRecoveryFixture();
  const feeBumpPlan = createFeeBumpSponsorPlan({
    feeAccount:G(7),
    innerEnvelopeHash:recovery.artifact.transactionHashHex,
    maxFeeStroops:'1000'
  });
  const artifact = buildFeeBumpEnvelopeArtifact({
    recoveryPlan:recovery.plan,
    recoveryArtifact:recovery.artifact,
    signedRecoveryTransactionXdr:recovery.signedRecoveryTransactionXdr,
    feeBumpPlan,
    baseFeeStroops:'200'
  });
  const signed = TransactionBuilder.fromXdr(artifact.feeBumpTransactionXdr, artifact.networkPassphrase);
  signed.sign(KP(7));
  const result = verifySignedFeeBumpEnvelopeArtifact({
    recoveryPlan:recovery.plan,
    recoveryArtifact:recovery.artifact,
    feeBumpPlan,
    artifact,
    signedFeeBumpTransactionXdr:signed.toXdr()
  });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.feePayerSignatureVerified, true);
  assert.equal(result.outerSignatureCount, 1);
  assert.equal(result.innerTransactionHashHex, recovery.artifact.transactionHashHex);
});

test('Stellar fee bump rejects wrong or extra outer signatures', () => {
  const recovery = signedRecoveryFixture();
  const feeBumpPlan = createFeeBumpSponsorPlan({
    feeAccount:G(7),
    innerEnvelopeHash:recovery.artifact.transactionHashHex,
    maxFeeStroops:'1000'
  });
  const artifact = buildFeeBumpEnvelopeArtifact({
    recoveryPlan:recovery.plan,
    recoveryArtifact:recovery.artifact,
    signedRecoveryTransactionXdr:recovery.signedRecoveryTransactionXdr,
    feeBumpPlan,
    baseFeeStroops:'200'
  });

  const wrong = TransactionBuilder.fromXdr(artifact.feeBumpTransactionXdr, artifact.networkPassphrase);
  wrong.sign(KP(8));
  const wrongResult = verifySignedFeeBumpEnvelopeArtifact({
    recoveryPlan:recovery.plan,
    recoveryArtifact:recovery.artifact,
    feeBumpPlan,
    artifact,
    signedFeeBumpTransactionXdr:wrong.toXdr()
  });
  assert.equal(wrongResult.valid, false);
  assert.equal(wrongResult.feePayerSignatureVerified, false);

  const extra = TransactionBuilder.fromXdr(artifact.feeBumpTransactionXdr, artifact.networkPassphrase);
  extra.sign(KP(7), KP(8));
  const extraResult = verifySignedFeeBumpEnvelopeArtifact({
    recoveryPlan:recovery.plan,
    recoveryArtifact:recovery.artifact,
    feeBumpPlan,
    artifact,
    signedFeeBumpTransactionXdr:extra.toXdr()
  });
  assert.equal(extraResult.valid, false);
  assert.equal(extraResult.outerSignatureCount, 2);
  assert.ok(extraResult.errors.some(error => /exactly one fee-payer signature/i.test(error)));
});

test('Stellar fee bump fails closed when total fee exceeds sponsor cap', () => {
  const recovery = signedRecoveryFixture();
  const feeBumpPlan = createFeeBumpSponsorPlan({
    feeAccount:G(7),
    innerEnvelopeHash:recovery.artifact.transactionHashHex,
    maxFeeStroops:'500'
  });
  assert.throws(() => buildFeeBumpEnvelopeArtifact({
    recoveryPlan:recovery.plan,
    recoveryArtifact:recovery.artifact,
    signedRecoveryTransactionXdr:recovery.signedRecoveryTransactionXdr,
    feeBumpPlan,
    baseFeeStroops:'200'
  }), /exceeds configured maximum/i);
});

test('Stellar fee bump refuses a substituted contact-signed inner recovery transaction', () => {
  const original = signedRecoveryFixture();
  const substitutedPlan = createRecoveryEnvelopePlan({
    vaultAccount:G(1), rescueDestination:G(2), currentSequence:'1000', inactivitySeconds:2592000,
    contacts:[G(3), G(4)], threshold:2,
    assets:['native', { code:'USDC', issuer:G(6) }],
    amounts:{ native:'11', [`USDC:${G(6)}`]:'20.5' }
  });
  const substitutedArtifact = buildRecoveryEnvelopeArtifact(substitutedPlan);
  const substituted = TransactionBuilder.fromXdr(substitutedArtifact.transactionXdr, substitutedPlan.networkPassphrase);
  substituted.sign(KP(3), KP(4));

  const feeBumpPlan = createFeeBumpSponsorPlan({
    feeAccount:G(7),
    innerEnvelopeHash:original.artifact.transactionHashHex,
    maxFeeStroops:'1000'
  });
  assert.throws(() => buildFeeBumpEnvelopeArtifact({
    recoveryPlan:original.plan,
    recoveryArtifact:original.artifact,
    signedRecoveryTransactionXdr:substituted.toXdr(),
    feeBumpPlan,
    baseFeeStroops:'200'
  }), /not eligible for fee-bump wrapping/i);
});

test('Stellar rejects imprecise and coerced native recovery sequences and policy gaps', () => {
  for(const invalid of [[1000],new Number(1000),{toString:()=> '1000'},true,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>chooseRecoverySequence({currentSequence:invalid}),/exact primitive non-negative integer sequence/);
    assert.throws(()=>createHeartbeatPlan({vaultAccount:G(1),currentSequence:invalid}),/exact primitive non-negative integer sequence/);
  }
  for(const invalid of [[1000],new Number(1000),Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>chooseRecoverySequence({currentSequence:'1000',gap:invalid}),/gap must be an exact primitive/);
    assert.throws(()=>chooseRecoverySequence({currentSequence:'1000',safetyMargin:invalid}),/safetyMargin must be an exact primitive/);
  }
  assert.equal(chooseRecoverySequence({currentSequence:1000n,gap:'2000',safetyMargin:'1000'}).recoverySequence,'3000');
});
