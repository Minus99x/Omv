import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import {
  canonicalCardanoEvidenceJson,
  createCardanoEvaluationEvidenceBundle,
  createCardanoSynchronizedEvaluationBundle,
  hashCardanoEvidence
} from '../src/chains/cardano/evidence-binding.js';
import { buildCardanoTransactionBodyFixture } from '../src/chains/cardano/transaction-body.js';

const bodyFixture = buildCardanoTransactionBodyFixture('initialize');
const transaction = Cardano.Transaction.new(
  Cardano.TransactionBody.from_hex(bodyFixture.cborHex),
  Cardano.TransactionWitnessSet.new()
);
const transactionCborHex = transaction.to_hex();
const bodyHash = Buffer.from(blake2b(transaction.body().to_bytes(), { dkLen: 32 })).toString('hex');
const tip = 'tip-316-deadbeef';

function fixture(overrides = {}) {
  const synchronizedState = {
    acquiredTipHash: tip,
    protocolParametersTipHash: tip,
    utxoSnapshotTipHash: tip,
    evaluationTipHash: tip,
    phaseOneTipHash: tip,
    transactionBodyHash: bodyHash,
    evaluationTransactionBodyHash: bodyHash,
    phaseOneTransactionBodyHash: bodyHash
  };
  const evaluation = { transactionBodyHash: bodyHash, budgets: [{ validator: 'spend:0', memory: '10', steps: '20' }] };
  const phaseOneValidation = {
    transactionBodyHash: bodyHash,
    passed: true,
    balanced: true,
    minimumAdaSatisfied: true,
    collateralSatisfied: true,
    witnessesSatisfied: true
  };
  return {
    network: 'preprod',
    transactionBodyHash: bodyHash,
    transactionCborHex,
    synchronizedState,
    utxoSnapshot: { tipHash: tip, utxos: [{ txId: '11'.repeat(32), index: 0, lovelace: '12000000' }] },
    protocolParameters: { epoch: 316, minFeeA: 44n, maxTxSize: 16384 },
    evaluation,
    phaseOneValidation,
    ...overrides
  };
}

function synchronizedFixture(overrides = {}) {
  return {
    network: 'preprod',
    transactionBodyHash: bodyHash,
    transactionCborHex,
    synchronizedState: {
      acquiredTipHash: tip,
      protocolParametersTipHash: tip,
      evaluationTipHash: tip,
      transactionBodyHash: bodyHash,
      evaluationTransactionBodyHash: bodyHash
    },
    protocolParameters: { epoch: 316 },
    evaluation: { transactionBodyHash: bodyHash },
    evaluationRequest: {
      method: 'evaluateTransaction',
      params: { transaction: { cbor: transactionCborHex }, additionalUtxo: [{}] }
    },
    ...overrides
  };
}

test('Cardano evidence hashing is deterministic across object key order and BigInt values', () => {
  const left = { z: 1, a: { y: 2n, x: 'ok' } };
  const right = { a: { x: 'ok', y: 2n }, z: 1 };
  assert.equal(canonicalCardanoEvidenceJson(left), canonicalCardanoEvidenceJson(right));
  assert.equal(hashCardanoEvidence(left), hashCardanoEvidence(right));
});

test('Cardano evidence bundle binds one transaction and one synchronized node tip', () => {
  const result = createCardanoEvaluationEvidenceBundle(fixture());
  assert.equal(result.schema, 'omegavault.cardano.evaluation-evidence.v1');
  assert.equal(result.tipHash, tip);
  assert.equal(result.transaction.bodyHash, bodyHash);
  assert.match(result.transaction.cborSha256, /^[0-9a-f]{64}$/);
  assert.match(result.bundleSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.phaseOneValidated, true);
  assert.equal(result.synchronized, true);
  assert.equal(result.promotionReadyEvidenceBinding, true);
});

test('Cardano evidence bundles verify the declared body hash against canonical transaction CBOR', () => {
  assert.throws(
    () => createCardanoEvaluationEvidenceBundle({
      ...fixture(),
      transactionBodyHash: 'cd'.repeat(32)
    }),
    /does not match the body encoded/
  );
  assert.throws(
    () => createCardanoEvaluationEvidenceBundle({
      ...fixture(),
      transactionCborHex: '84'.repeat(16)
    }),
    /valid Cardano transaction/
  );
  assert.throws(
    () => createCardanoSynchronizedEvaluationBundle({
      ...synchronizedFixture(),
      transactionBodyHash: 'cd'.repeat(32)
    }),
    /does not match the body encoded/
  );
  assert.throws(
    () => createCardanoSynchronizedEvaluationBundle({
      ...synchronizedFixture(),
      transactionCborHex: '84'.repeat(16),
      evaluationRequest: {
        method: 'evaluateTransaction',
        params: { transaction: { cbor: '84'.repeat(16) }, additionalUtxo: [{}] }
      }
    }),
    /valid Cardano transaction/
  );
});

test('Cardano evidence bundle rejects cross-tip evidence', () => {
  const input = fixture();
  input.synchronizedState = { ...input.synchronizedState, utxoSnapshotTipHash: 'other-tip' };
  assert.throws(() => createCardanoEvaluationEvidenceBundle(input), /one acquired node tip/);
});

test('Cardano evidence bundle rejects evaluation or phase-1 evidence for another transaction', () => {
  const input = fixture();
  input.evaluation = { ...input.evaluation, transactionBodyHash: 'cd'.repeat(32) };
  assert.throws(() => createCardanoEvaluationEvidenceBundle(input), /different transaction body/);

  const second = fixture();
  second.phaseOneValidation = { ...second.phaseOneValidation, transactionBodyHash: 'ef'.repeat(32) };
  assert.throws(() => createCardanoEvaluationEvidenceBundle(second), /different transaction body/);
});

test('Cardano evidence bundle requires all independent phase-1 checks to pass', () => {
  const input = fixture();
  input.phaseOneValidation = { ...input.phaseOneValidation, collateralSatisfied: false };
  assert.throws(() => createCardanoEvaluationEvidenceBundle(input), /phase-1 validation must pass/);
});

test('Cardano evidence bundle digest changes when any bound component changes', () => {
  const original = createCardanoEvaluationEvidenceBundle(fixture());
  const changedInput = fixture();
  changedInput.utxoSnapshot = { ...changedInput.utxoSnapshot, utxos: [{ ...changedInput.utxoSnapshot.utxos[0], lovelace: '11999999' }] };
  const changed = createCardanoEvaluationEvidenceBundle(changedInput);
  assert.notEqual(original.components.utxoSnapshotSha256, changed.components.utxoSnapshotSha256);
  assert.notEqual(original.bundleSha256, changed.bundleSha256);
});

test('Cardano evidence canonicalizer fails closed on unsupported values', () => {
  assert.throws(() => hashCardanoEvidence({ bad: undefined }), /unsupported evidence data/);
  assert.throws(() => hashCardanoEvidence({ bad: Number.NaN }), /non-finite/);
  assert.throws(() => hashCardanoEvidence(new Date()), /plain evidence objects/);
});
