import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateCardanoExecutionFee,
  calculateCardanoMinimumFee,
  calculateCardanoRequiredCollateral,
  createCardanoProtocolParameterGate,
  normalizeCardanoProtocolParameterSnapshot
} from '../src/chains/cardano/protocol-parameters.js';

const evidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
const parameters = normalizeCardanoProtocolParameterSnapshot(evidence);

test('Cardano protocol snapshot binds epoch, provenance and complete Plutus V3 cost model', () => {
  assert.equal(parameters.epoch, 316);
  assert.equal(parameters.plutusV3CostModel.length, 350);
  assert.equal(parameters.plutusV3CostModelSha256, '6b74a19b00bcca178a4c723c0ce871d41fc5c5a417d738798faea60930961b4e');
});

test('Cardano parameter gate refuses a single current provider for live construction', () => {
  const gate = createCardanoProtocolParameterGate([parameters]);
  assert.equal(gate.liveConstructionReady, false);
  assert.match(gate.reason, /two independent/);
});

test('Cardano execution fee uses exact rational arithmetic', () => {
  assert.equal(calculateCardanoExecutionFee({ memory: 494618, steps: 158755371, parameters }).toString(), '39986');
});

test('Cardano minimum fee combines serialized size and execution units', () => {
  const result = calculateCardanoMinimumFee({ transactionBytes: 480, memory: 494618, steps: 158755371, parameters });
  assert.deepEqual(result, { linearFee: '176501', executionFee: '39986', minimumFee: '216487', transactionBytes: 480, exactForProvidedSizeAndExUnits: true });
  assert.throws(() => calculateCardanoMinimumFee({ transactionBytes: 20000, parameters }), /maxTxSize/);
});

test('Cardano collateral rounds upward and rejects token-bearing or excess inputs', () => {
  assert.equal(calculateCardanoRequiredCollateral({ feeLovelace: '216495', parameters }).requiredCollateral, '324743');
  assert.throws(() => calculateCardanoRequiredCollateral({ feeLovelace: '216495', parameters, collateralIsAdaOnly: false }), /ADA only/);
  assert.throws(() => calculateCardanoRequiredCollateral({ feeLovelace: '216495', parameters, collateralInputCount: 4 }), /protocol limits/);
});


test('Cardano gate does not double-count duplicate provider evidence', () => {
  const singleProvider = Object.freeze({ ...parameters, sourceCount: 1, independentlyConfirmed: true });
  const gate = createCardanoProtocolParameterGate([singleProvider, singleProvider]);
  assert.equal(gate.independentSourceCount, 1);
  assert.equal(gate.liveConstructionReady, false);
  assert.match(gate.reason, /two independent/);
});

test('Cardano gate explains missing independent confirmation', () => {
  const unconfirmed = Object.freeze({ ...parameters, sourceCount: 2, independentlyConfirmed: false });
  const gate = createCardanoProtocolParameterGate([unconfirmed]);
  assert.equal(gate.liveConstructionReady, false);
  assert.match(gate.reason, /confirmation/);
});


test('Cardano gate fails closed on invalid independent-source counts', () => {
  for (const sourceCount of [undefined, null, 0, -1, 1.5, NaN, Infinity, '2']) {
    const malformed = { ...parameters, sourceCount, independentlyConfirmed: true };
    assert.throws(() => createCardanoProtocolParameterGate([malformed]), /positive independent source count/);
  }
});


test('Cardano gate rejects conflicting execution budgets and prices', () => {
  const baseline = { ...parameters, sourceCount: 2, independentlyConfirmed: true };
  const alteredBudget = { ...baseline, maxTxExUnits: { ...baseline.maxTxExUnits, memory: baseline.maxTxExUnits.memory + 1n } };
  const alteredPrice = { ...baseline, priceSteps: { ...baseline.priceSteps, numerator: baseline.priceSteps.numerator + 1n } };
  for (const altered of [alteredBudget, alteredPrice]) {
    const gate = createCardanoProtocolParameterGate([baseline, altered]);
    assert.equal(gate.matching, false);
    assert.equal(gate.liveConstructionReady, false);
    assert.match(gate.reason, /disagree/);
  }
});


test('Cardano snapshot rejects protocol limits outside the safe integer range', () => {
  for (const field of ['maxTxSize', 'maxValueSize', 'maxCollateralInputs']) {
    const malformed = structuredClone(evidence);
    malformed.parameters[field] = '9007199254740993';
    assert.throws(() => normalizeCardanoProtocolParameterSnapshot(malformed), /safe integer range/);
  }
});


test('Cardano arithmetic rejects imprecise numeric inputs before BigInt conversion', () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => calculateCardanoRequiredCollateral({ feeLovelace: value, parameters }), /safe integer/);
  }
  for (const value of [true, null, {}, 1.5, -1]) {
    assert.throws(() => calculateCardanoRequiredCollateral({ feeLovelace: value, parameters }), /unsigned integer/);
  }
  assert.equal(calculateCardanoRequiredCollateral({ feeLovelace: '9007199254740993', parameters }).requiredCollateral, '13510798882111490');
});


test('Cardano snapshot rejects unsafe provenance counts and malformed tip epochs', () => {
  const cases = [
    snapshot => { snapshot.source.independentSourceCount = Number.MAX_SAFE_INTEGER + 1; },
    snapshot => { delete snapshot.tip; },
    snapshot => { snapshot.tip.epoch = Number.MAX_SAFE_INTEGER + 1; },
    snapshot => { snapshot.parameters.epoch = Number.MAX_SAFE_INTEGER + 1; }
  ];
  for (const mutate of cases) {
    const malformed = structuredClone(evidence);
    mutate(malformed);
    assert.throws(() => normalizeCardanoProtocolParameterSnapshot(malformed), /provenance|epoch/);
  }
});
