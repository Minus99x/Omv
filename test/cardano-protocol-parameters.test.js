import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('Cardano protocol snapshots reject sparse cost models even when their digest matches', () => {
  const malformed = structuredClone(evidence);
  delete malformed.parameters.plutusV3CostModel[174];
  malformed.parameters.plutusV3CostModelSha256 = createHash('sha256')
    .update(JSON.stringify(malformed.parameters.plutusV3CostModel))
    .digest('hex');
  assert.throws(
    () => normalizeCardanoProtocolParameterSnapshot(malformed),
    /complete 350-entry Plutus V3 cost model/
  );

  const sparseNormalized = {
    ...parameters,
    plutusV3CostModel: [...parameters.plutusV3CostModel]
  };
  delete sparseNormalized.plutusV3CostModel[174];
  sparseNormalized.plutusV3CostModelSha256 = createHash('sha256')
    .update(JSON.stringify(sparseNormalized.plutusV3CostModel))
    .digest('hex');
  const gate = createCardanoProtocolParameterGate([sparseNormalized]);
  assert.equal(gate.matching, false);
  assert.equal(gate.liveConstructionReady, false);
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
  for (const value of [true, null, {}, -1]) {
    assert.throws(() => calculateCardanoRequiredCollateral({ feeLovelace: value, parameters }), /unsigned integer/);
  }
  assert.throws(() => calculateCardanoRequiredCollateral({ feeLovelace: 1.5, parameters }), /safe integer/);
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


test('Cardano gate rejects incomplete and wrong-era snapshots even when both agree', () => {
  const baseline = { ...parameters, sourceCount: 2, independentlyConfirmed: true };
  const mutations = [
    snapshot => { delete snapshot.minFeeA; },
    snapshot => { delete snapshot.priceMemory; },
    snapshot => { delete snapshot.maxTxExUnits; },
    snapshot => { snapshot.era = 'Babbage'; }
  ];
  for (const mutate of mutations) {
    const left = { ...baseline };
    const right = { ...baseline };
    mutate(left);
    mutate(right);
    const gate = createCardanoProtocolParameterGate([left, right]);
    assert.equal(gate.liveConstructionReady, false);
    assert.equal(gate.matching, false);
  }
});


test('Cardano collateral rejects unsafe input counts', () => {
  for (const collateralInputCount of [Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, 1.5, 0, -1]) {
    assert.throws(() => calculateCardanoRequiredCollateral({ feeLovelace: '1000000', parameters, collateralInputCount }), /protocol limits/);
  }
});


test('Cardano collateral requires explicit boolean ADA-only attestation', () => {
  for (const collateralIsAdaOnly of ['false', 'true', 1, {}, [], null, false]) {
    assert.throws(() => calculateCardanoRequiredCollateral({ feeLovelace: '1000000', parameters, collateralIsAdaOnly }), /ADA only/);
  }
  assert.equal(calculateCardanoRequiredCollateral({ feeLovelace: '1000000', parameters, collateralIsAdaOnly: true }).collateralIsAdaOnly, true);
});


test('Cardano gate rejects truthy nonboolean independent confirmations', () => {
  for (const independentlyConfirmed of ['true', 1, {}, [], null]) {
    const malformed = { ...parameters, sourceCount: 2, independentlyConfirmed };
    const gate = createCardanoProtocolParameterGate([malformed]);
    assert.equal(gate.liveConstructionReady, false);
    assert.match(gate.reason, /confirmation/);
  }
});


test('Cardano live readiness preserves explicit construction and connector restrictions', () => {
  const snapshot = structuredClone(evidence);
  snapshot.source.independentSourceCount = 2;
  snapshot.promotion.independentlyConfirmed = true;
  snapshot.promotion.eligibleForLiveTransactionConstruction = false;
  snapshot.promotion.connectorLiveProof = false;
  const normalized = normalizeCardanoProtocolParameterSnapshot(snapshot);
  assert.equal(normalized.eligibleForLiveTransactionConstruction, false);
  assert.equal(normalized.connectorLiveProof, false);
  const blocked = createCardanoProtocolParameterGate([normalized]);
  assert.equal(blocked.liveConstructionReady, false);
  assert.match(blocked.reason, /eligibility and connector proof/);
  for (const [eligibility, proof] of [[true, false], [false, true], ['true', true], [true, 'true']]) {
    const modified = structuredClone(snapshot);
    modified.promotion.eligibleForLiveTransactionConstruction = eligibility;
    modified.promotion.connectorLiveProof = proof;
    assert.equal(createCardanoProtocolParameterGate([normalizeCardanoProtocolParameterSnapshot(modified)]).liveConstructionReady, false);
  }
});

test('Cardano readiness gate rejects null execution prices and budgets even when snapshots agree', () => {
  const baseline = { ...parameters, sourceCount: 2, independentlyConfirmed: true,
    eligibleForLiveTransactionConstruction: true, connectorLiveProof: true };
  const mutations = [
    snapshot => { snapshot.priceMemory = { ...baseline.priceMemory, numerator: null }; },
    snapshot => { snapshot.priceMemory = { ...baseline.priceMemory, denominator: null }; },
    snapshot => { snapshot.priceSteps = { ...baseline.priceSteps, numerator: null }; },
    snapshot => { snapshot.priceSteps = { ...baseline.priceSteps, denominator: null }; },
    snapshot => { snapshot.maxTxExUnits = { ...baseline.maxTxExUnits, memory: null }; },
    snapshot => { snapshot.maxTxExUnits = { ...baseline.maxTxExUnits, steps: null }; }
  ];
  for (const mutate of mutations) {
    const left = { ...baseline };
    const right = { ...baseline };
    mutate(left);
    mutate(right);
    const gate = createCardanoProtocolParameterGate([left, right]);
    assert.equal(gate.matching, false);
    assert.equal(gate.liveConstructionReady, false);
    assert.match(gate.reason, /Complete Conway/);
  }
});

test('Cardano readiness gate rejects malformed normalized numeric fields even with unanimous authorization', () => {
  const baseline = { ...parameters, sourceCount: 2, independentlyConfirmed: true,
    eligibleForLiveTransactionConstruction: true, connectorLiveProof: true };
  const mutations = [
    snapshot => { snapshot.priceMemory = { ...baseline.priceMemory, numerator: 'garbage' }; },
    snapshot => { snapshot.priceSteps = { ...baseline.priceSteps, denominator: 0n }; },
    snapshot => { snapshot.maxTxExUnits = { ...baseline.maxTxExUnits, memory: -1n }; },
    snapshot => { snapshot.minFeeA = '44'; },
    snapshot => { snapshot.minFeeB = 0n; },
    snapshot => { snapshot.maxTxSize = '16384'; },
    snapshot => { snapshot.maxCollateralInputs = Infinity; },
    snapshot => { snapshot.epoch = '316'; },
    snapshot => { snapshot.protocolVersion = 'invalid'; },
    snapshot => { snapshot.plutusV3CostModelSha256 = 'not-a-digest'; }
  ];
  for (const mutate of mutations) {
    const left = { ...baseline };
    const right = { ...baseline };
    mutate(left);
    mutate(right);
    const gate = createCardanoProtocolParameterGate([left, right]);
    assert.equal(gate.matching, false);
    assert.equal(gate.liveConstructionReady, false);
    assert.match(gate.reason, /Complete Conway/);
  }
});

test('Cardano snapshot bounds hostile decimal integer strings before BigInt parsing', () => {
  const huge = '9'.repeat(100000);
  for (const field of ['minFeeA', 'minFeeB', 'maxTxSize', 'maxValueSize', 'coinsPerUtxoByte',
    'collateralPercentage', 'maxCollateralInputs']) {
    const malformed = structuredClone(evidence);
    malformed.parameters[field] = huge;
    assert.throws(() => normalizeCardanoProtocolParameterSnapshot(malformed), /integer precision exceeds the supported limit/);
  }
  for (const [parent, field] of [
    ['priceMemory', 'numerator'],
    ['priceMemory', 'denominator'],
    ['priceSteps', 'numerator'],
    ['priceSteps', 'denominator'],
    ['maxTxExUnits', 'memory'],
    ['maxTxExUnits', 'steps']
  ]) {
    const malformed = structuredClone(evidence);
    malformed.parameters[parent][field] = huge;
    assert.throws(() => normalizeCardanoProtocolParameterSnapshot(malformed), /integer precision exceeds the supported limit/);
  }
});

test('Cardano execution fee and collateral arithmetic bound hostile unsigned integer inputs', () => {
  const huge = '9'.repeat(100000);
  for (const value of [huge, '0'.repeat(100001)]) {
    assert.throws(() => calculateCardanoExecutionFee({
      memory: value, steps: 1, parameters
    }), /integer precision exceeds the supported limit/);
    assert.throws(() => calculateCardanoExecutionFee({
      memory: 1, steps: value, parameters
    }), /integer precision exceeds the supported limit/);
    assert.throws(() => calculateCardanoRequiredCollateral({
      feeLovelace: value, parameters
    }), /integer precision exceeds the supported limit/);
  }
  assert.equal(calculateCardanoRequiredCollateral({
    feeLovelace: '9'.repeat(1000), parameters
  }).requiredCollateral, ((BigInt('9'.repeat(1000)) * 150n + 99n) / 100n).toString());
});

test('Cardano readiness gate validates actual Plutus V3 coefficients, not merely matching digest strings', () => {
  const baseline = {
    ...parameters,
    sourceCount: 2,
    independentlyConfirmed: true,
    eligibleForLiveTransactionConstruction: true,
    connectorLiveProof: true
  };
  const historical = createCardanoProtocolParameterGate([baseline, baseline]);
  assert.equal(historical.matching, true);
  assert.equal(historical.liveConstructionReady, false);
  assert.match(historical.reason, /maxValueSize/);

  const current = { ...baseline, maxValueSize: 5000 };
  const valid = createCardanoProtocolParameterGate([current, current]);
  assert.equal(valid.matching, true);
  assert.equal(valid.liveConstructionReady, true);

  const mutations = [
    snapshot => { delete snapshot.plutusV3CostModel; },
    snapshot => { snapshot.plutusV3CostModel = []; },
    snapshot => { snapshot.plutusV3CostModel = baseline.plutusV3CostModel.slice(1); },
    snapshot => { snapshot.plutusV3CostModel = [...baseline.plutusV3CostModel]; snapshot.plutusV3CostModel[0] += 1; },
    snapshot => { snapshot.plutusV3CostModel = [...baseline.plutusV3CostModel]; snapshot.plutusV3CostModel[0] = '100788'; },
    snapshot => { snapshot.plutusV3CostModel = [...baseline.plutusV3CostModel]; snapshot.plutusV3CostModel[0] = Number.MAX_SAFE_INTEGER + 1; },
    snapshot => { snapshot.plutusV3CostModel = [...baseline.plutusV3CostModel]; snapshot.plutusV3CostModel[0] = NaN; }
  ];
  for (const mutate of mutations) {
    const left = { ...current };
    const right = { ...current };
    mutate(left);
    mutate(right);
    const gate = createCardanoProtocolParameterGate([left, right]);
    assert.equal(gate.matching, false);
    assert.equal(gate.liveConstructionReady, false);
    assert.match(gate.reason, /Complete Conway/);
  }
});
