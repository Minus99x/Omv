import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  createStellarFailedAppliedRecoveryEvidenceBundle,
  createStellarTestnetRecoveryEvidenceBundle,
  verifyStellarFailedAppliedRecoveryEvidenceBundle,
  verifyStellarTestnetRecoveryEvidenceBundle
} from '../src/chains/stellar/evidence-binding.js';

const G = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n)).publicKey();
const H = byte => byte.repeat(64);

function fixture(overrides = {}) {
  const recoveryTransactionHashHex = H('a');
  const outerTransactionHashHex = H('c');
  return {
    networkRef: 'stellar:testnet',
    recoveryTransactionHashHex,
    preAuthTxSigner: StrKey.encodePreAuthTx(Uint8Array.from({ length: 32 }, () => 0xaa)),
    recoverySequence: '1000',
    initialTooEarly: {
      transactionHashHex: recoveryTransactionHashHex,
      observedAt: '2026-10-03T00:00:00Z',
      includedInLedger: false,
      successful: false,
      resultCode: 'txTOO_EARLY'
    },
    heartbeat: {
      transactionHashHex: H('b'),
      observedAt: '2026-10-03T00:01:00Z',
      includedInLedger: true,
      successful: true,
      sequenceBefore: '100',
      sequenceAfter: '102',
      ledger: '500'
    },
    postHeartbeatTooEarly: {
      transactionHashHex: recoveryTransactionHashHex,
      observedAt: '2026-10-03T00:02:00Z',
      includedInLedger: false,
      successful: false,
      resultCode: 'txTOO_EARLY'
    },
    eligibleSubmission: {
      innerTransactionHashHex: recoveryTransactionHashHex,
      outerTransactionHashHex,
      observedAt: '2026-10-03T00:03:00Z',
      includedInLedger: true,
      successful: true,
      resultCode: 'txSUCCESS',
      ledger: '501'
    },
    feeBump: {
      innerTransactionHashHex: recoveryTransactionHashHex,
      outerTransactionHashHex,
      feeAccount: G(7),
      feeStroops: '200'
    },
    accountState: {
      before: { sequence: '102', preAuthTxSignerPresent: true },
      after: { sequence: '1000', preAuthTxSignerPresent: false }
    },
    balanceMovements: [{
      assetKey: 'native',
      expectedTransferUnits: '100',
      vaultBeforeUnits: '1000',
      vaultAfterUnits: '900',
      rescueBeforeUnits: '50',
      rescueAfterUnits: '150'
    }],
    finality: {
      status: 'finalized',
      transactionHashHex: outerTransactionHashHex,
      ledger: '501',
      ledgerHash: H('d'),
      observedAt: '2026-10-03T00:04:00Z'
    },
    ...overrides
  };
}

test('Stellar Testnet evidence bundle binds liveness reset, fee bump, recovery, balances and finality', () => {
  const bundle = createStellarTestnetRecoveryEvidenceBundle(fixture());
  assert.equal(bundle.schema, 'omegavault.stellar.testnet-recovery-evidence.v1');
  assert.equal(bundle.chainId, 'stellar');
  assert.equal(bundle.networkRef, 'stellar:testnet');
  assert.equal(bundle.publicTestnetEvidenceReady, true);
  assert.equal(bundle.promotionAuthority, false);
  assert.match(bundle.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(verifyStellarTestnetRecoveryEvidenceBundle(bundle), { ok: true, errors: [] });
});

test('Stellar Testnet evidence rejects a fee bump bound to another inner recovery transaction', () => {
  const input = fixture();
  input.feeBump = { ...input.feeBump, innerTransactionHashHex: H('e') };
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(input), /different inner recovery transaction/i);
});

test('Stellar Testnet evidence rejects incorrect vault or rescue balance deltas', () => {
  const input = fixture();
  input.balanceMovements = [{ ...input.balanceMovements[0], rescueAfterUnits: '149' }];
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(input), /rescue delta/i);

  const second = fixture();
  second.balanceMovements = [{ ...second.balanceMovements[0], vaultAfterUnits: '901' }];
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(second), /vault delta/i);
});

test('Stellar Testnet evidence requires preAuth signer consumption after applied recovery', () => {
  const input = fixture();
  input.accountState = {
    ...input.accountState,
    after: { ...input.accountState.after, preAuthTxSignerPresent: true }
  };
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(input), /must be absent/i);
});

test('Stellar Testnet evidence requires a post-heartbeat too-early rejection before eligibility', () => {
  const input = fixture();
  input.postHeartbeatTooEarly = {
    ...input.postHeartbeatTooEarly,
    includedInLedger: true,
    successful: true
  };
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(input), /must prove rejection/i);
});

test('Stellar Testnet evidence rejects non-monotonic proof timelines', () => {
  const input = fixture();
  input.postHeartbeatTooEarly = {
    ...input.postHeartbeatTooEarly,
    observedAt: '2026-10-02T23:59:00Z'
  };
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(input), /timeline is not monotonic/i);
});

test('Stellar Testnet evidence rejects duplicate asset movements', () => {
  const input = fixture();
  input.balanceMovements = [input.balanceMovements[0], { ...input.balanceMovements[0] }];
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(input), /duplicate assets/i);
});

test('tampered Stellar Testnet evidence digest fails closed', () => {
  const bundle = structuredClone(createStellarTestnetRecoveryEvidenceBundle(fixture()));
  bundle.balanceMovements[0].rescueAfterUnits = '151';
  const result = verifyStellarTestnetRecoveryEvidenceBundle(bundle);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /delta|digest/i.test(error)));
});


test('Stellar Testnet evidence requires exact too-early and success result codes', () => {
  const wrongEarly = fixture();
  wrongEarly.initialTooEarly = { ...wrongEarly.initialTooEarly, resultCode:'txFAILED' };
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(wrongEarly), /txTOO_EARLY/);

  const wrongSuccess = fixture();
  wrongSuccess.eligibleSubmission = { ...wrongSuccess.eligibleSubmission, resultCode:'txFAILED' };
  assert.throws(() => createStellarTestnetRecoveryEvidenceBundle(wrongSuccess), /txSUCCESS/);
});


test('Stellar failed-applied evidence proves one-time preAuth signer consumption and forbids replay', () => {
  const recoveryTransactionHashHex = H('a');
  const bundle = createStellarFailedAppliedRecoveryEvidenceBundle({
    networkRef:'stellar:testnet',
    recoveryTransactionHashHex,
    preAuthTxSigner:StrKey.encodePreAuthTx(Uint8Array.from({ length:32 }, () => 0xaa)),
    recoverySequence:'1000',
    submission:{
      transactionHashHex:recoveryTransactionHashHex,
      observedAt:'2026-10-03T00:04:00Z',
      includedInLedger:true,
      successful:false,
      resultCode:'txFAILED',
      ledger:'501'
    },
    accountState:{
      before:{ sequence:'102', preAuthTxSignerPresent:true },
      after:{ sequence:'1000', preAuthTxSignerPresent:false }
    }
  });
  assert.equal(bundle.preAuthSignerConsumed, true);
  assert.equal(bundle.retrySameEnvelope, false);
  assert.match(bundle.requiredAction, /rebuild/i);
  assert.match(bundle.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(verifyStellarFailedAppliedRecoveryEvidenceBundle(bundle), { ok:true, errors:[] });
});

test('Stellar failed-applied evidence rejects non-applied failures and signer-survival drift', () => {
  const recoveryTransactionHashHex = H('a');
  const base = {
    networkRef:'stellar:testnet',
    recoveryTransactionHashHex,
    preAuthTxSigner:StrKey.encodePreAuthTx(Uint8Array.from({ length:32 }, () => 0xaa)),
    recoverySequence:'1000',
    submission:{
      transactionHashHex:recoveryTransactionHashHex,
      observedAt:'2026-10-03T00:04:00Z',
      includedInLedger:true,
      successful:false,
      resultCode:'txFAILED',
      ledger:'501'
    },
    accountState:{
      before:{ sequence:'102', preAuthTxSignerPresent:true },
      after:{ sequence:'1000', preAuthTxSignerPresent:false }
    }
  };
  assert.throws(() => createStellarFailedAppliedRecoveryEvidenceBundle({
    ...base, submission:{ ...base.submission, includedInLedger:false }
  }), /included but unsuccessful/i);
  assert.throws(() => createStellarFailedAppliedRecoveryEvidenceBundle({
    ...base, accountState:{ ...base.accountState, after:{ ...base.accountState.after, preAuthTxSignerPresent:true } }
  }), /consumed after application/i);
});

test('tampered Stellar failed-applied evidence fails closed', () => {
  const recoveryTransactionHashHex = H('a');
  const bundle = structuredClone(createStellarFailedAppliedRecoveryEvidenceBundle({
    networkRef:'stellar:testnet',
    recoveryTransactionHashHex,
    preAuthTxSigner:StrKey.encodePreAuthTx(Uint8Array.from({ length:32 }, () => 0xaa)),
    recoverySequence:'1000',
    submission:{
      transactionHashHex:recoveryTransactionHashHex,
      observedAt:'2026-10-03T00:04:00Z',
      includedInLedger:true,
      successful:false,
      resultCode:'txFAILED',
      ledger:'501'
    },
    accountState:{
      before:{ sequence:'102', preAuthTxSignerPresent:true },
      after:{ sequence:'1000', preAuthTxSignerPresent:false }
    }
  }));
  bundle.submission.resultCode = 'txBAD_AUTH';
  assert.equal(verifyStellarFailedAppliedRecoveryEvidenceBundle(bundle).ok, false);
});
