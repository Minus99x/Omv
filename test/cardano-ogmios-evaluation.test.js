import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { buildCardanoOgmiosEvaluationFixture, buildCardanoWitnessSetFixture } from '../src/chains/cardano/witness-set.js';
import {
  createCardanoLedgerEvaluationGate,
  createCardanoOgmiosEvaluationRequest,
  normalizeCardanoOgmiosEvaluation
} from '../src/chains/cardano/ogmios-evaluation.js';

const evidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
const parameters = normalizeCardanoProtocolParameterSnapshot(evidence);
const beacon = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vault = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode = beacon.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode = vault.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;

function requestFor(action = 'execute') {
  const fixture = buildCardanoOgmiosEvaluationFixture({ action, parameters, recoveryCompiledCode, beaconCompiledCode });
  return createCardanoOgmiosEvaluationRequest({ transactionCborHex: fixture.transactionCborHex, id: `evaluate-${action}` });
}

test('Cardano Ogmios request binds zero-budget CBOR, body hash and exact redeemer pointers', () => {
  const result = requestFor('execute');
  assert.equal(result.request.method, 'evaluateTransaction');
  assert.deepEqual(result.expectedValidators, ['mint:0', 'spend:0']);
  assert.match(result.transactionBodyHash, /^[0-9a-f]{64}$/);
  assert.equal(result.requiresSeparatePhaseOneValidation, true);
});

test('Cardano Ogmios request rejects non-canonical CBOR before binding a body hash', () => {
  const fixture = buildCardanoOgmiosEvaluationFixture({ action: 'execute', parameters, recoveryCompiledCode, beaconCompiledCode });
  const transactionBytes = Buffer.from(fixture.transactionCborHex, 'hex');
  assert.equal(transactionBytes[0], 0x84, 'fixture uses a four-element transaction array');
  const nonCanonicalTransaction = Buffer.concat([
    Buffer.from([0x98, 0x04]),
    transactionBytes.subarray(1)
  ]).toString('hex');
  assert.throws(
    () => createCardanoOgmiosEvaluationRequest({ transactionCborHex: nonCanonicalTransaction }),
    /must round-trip canonically/
  );
});

test('Cardano Ogmios v7 request uses additionalUtxo with the flat UTxO schema', () => {
  const fixture = buildCardanoOgmiosEvaluationFixture({ action: 'execute', parameters, recoveryCompiledCode, beaconCompiledCode });
  const supplemental = [{
    transaction: { id: 'aa'.repeat(32) },
    index: 0,
    address: 'addr_test1vptest',
    value: { ada: { lovelace: 10000000 } }
  }];
  const result = createCardanoOgmiosEvaluationRequest({
    transactionCborHex: fixture.transactionCborHex,
    additionalUtxoSet: supplemental,
    id: 'evaluate-v7-shape'
  });
  assert.deepEqual(result.request.params.additionalUtxo, supplemental);
  assert.equal(Object.hasOwn(result.request.params, 'additionalUtxoSet'), false);
});

test('Cardano Ogmios v7 structured validator pointer normalizes to canonical redeemer pointer', () => {
  const request = requestFor('initialize');
  const evaluation = normalizeCardanoOgmiosEvaluation({
    response: {
      jsonrpc: '2.0',
      method: 'evaluateTransaction',
      id: 'evaluate-initialize',
      result: [
        { validator: { purpose: 'mint', index: 0 }, budget: { memory: 91970, cpu: 27959404 } }
      ]
    },
    requestId: request.request.id,
    expectedValidators: request.expectedValidators,
    parameters
  });
  assert.equal(evaluation.budgets[0].validator, 'mint:0');
});

test('Cardano Ogmios response applies a ceiling 10 percent budget margin', () => {
  const request = requestFor('execute');
  const evaluation = normalizeCardanoOgmiosEvaluation({
    response: {
      jsonrpc: '2.0', method: 'evaluateTransaction', id: 'evaluate-execute',
      result: [
        { validator: 'spend:0', budget: { memory: 423054, cpu: 133367503 } },
        { validator: 'mint:0', budget: { memory: 91970, cpu: 27959404 } }
      ]
    },
    requestId: request.request.id,
    expectedValidators: request.expectedValidators,
    parameters
  });
  assert.equal(evaluation.totalMemory, '566527');
  assert.equal(evaluation.totalSteps, '177459599');
  assert.equal(evaluation.phaseOneValidated, false);
});

test('Cardano Ogmios response rejects omitted, duplicate, unexpected and zero budgets', () => {
  const request = requestFor('execute');
  const base = { jsonrpc: '2.0', method: 'evaluateTransaction', id: 'evaluate-execute' };
  const parse = result => normalizeCardanoOgmiosEvaluation({ response: { ...base, result }, requestId: base.id, expectedValidators: request.expectedValidators, parameters });
  assert.throws(() => parse([{ validator: 'spend:0', budget: { memory: 1, cpu: 1 } }]), /omitted/);
  assert.throws(() => parse([{ validator: 'spend:0', budget: { memory: 1, cpu: 1 } }, { validator: 'spend:0', budget: { memory: 1, cpu: 1 } }]), /Duplicate/);
  assert.throws(() => parse([{ validator: 'spend:1', budget: { memory: 1, cpu: 1 } }]), /Unexpected/);
  assert.throws(() => parse([{ validator: 'spend:0', budget: { memory: 0, cpu: 1 } }]), /positive/);
});

test('Cardano ledger gate requires one acquired tip and independent phase-1 validation', () => {
  const evaluation = { budgets: [] };
  const synchronizedState = { acquiredTipHash: 'aa', protocolParametersTipHash: 'aa', evaluationTipHash: 'aa' };
  const phaseOneValidation = { passed: true, balanced: true, minimumAdaSatisfied: true, collateralSatisfied: true, witnessesSatisfied: true };
  assert.equal(createCardanoLedgerEvaluationGate({ evaluation, synchronizedState, phaseOneValidation }).ready, true);
  assert.equal(createCardanoLedgerEvaluationGate({ evaluation, synchronizedState: { ...synchronizedState, evaluationTipHash: 'bb' }, phaseOneValidation }).ready, false);
  assert.match(createCardanoLedgerEvaluationGate({ evaluation, synchronizedState, phaseOneValidation: { ...phaseOneValidation, balanced: false } }).reason, /phase-1/);
});

test('Cardano Ogmios request refuses already-budgeted redeemers', () => {
  const fixture = buildCardanoWitnessSetFixture({ action: 'heartbeat', parameters, recoveryCompiledCode, beaconCompiledCode });
  assert.throws(() => createCardanoOgmiosEvaluationRequest({ transactionCborHex: fixture.transactionCborHex }), /budget to zero/);
});
