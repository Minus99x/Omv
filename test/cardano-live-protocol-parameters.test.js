import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardanoPreprodLiveProtocolSnapshot } from '../src/chains/cardano/live-protocol-parameters.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';

const model = Array.from({ length: 350 }, (_, index) => index - 10);
const tip = { hash: 'ab'.repeat(32), slot: 123456789 };

function ogmios() {
  return {
    version: { major: 11, minor: 0 },
    minFeeCoefficient: 44,
    minFeeConstant: { ada: { lovelace: 155381 } },
    maxTransactionSize: { bytes: 16384 },
    maxValueSize: { bytes: 5000 },
    minUtxoDepositCoefficient: 4310,
    scriptExecutionPrices: { memory: '577/10000', cpu: '721/10000000' },
    maxExecutionUnitsPerTransaction: { memory: 17500000, cpu: 10000000000 },
    collateralPercentage: 150,
    maxCollateralInputs: 3,
    plutusCostModels: { 'plutus:v3': model }
  };
}

function blockfrost() {
  return {
    epoch: 400,
    protocol_major_ver: 11,
    protocol_minor_ver: 0,
    min_fee_a: 44,
    min_fee_b: 155381,
    max_tx_size: 16384,
    max_val_size: '5000',
    coins_per_utxo_size: '4310',
    price_mem: 0.0577,
    price_step: 0.0000721,
    max_tx_ex_mem: '17500000',
    max_tx_ex_steps: '10000000000',
    collateral_percent: 150,
    max_collateral_inputs: 3,
    cost_models_raw: { PlutusV3: model }
  };
}

test('current Preprod protocol snapshot requires and records Ogmios/Blockfrost agreement', () => {
  const snapshot = createCardanoPreprodLiveProtocolSnapshot({
    ogmiosParameters: ogmios(),
    blockfrostParameters: blockfrost(),
    epoch: 400,
    tip,
    blockHeight: 6000000,
    capturedAt: '2026-10-05T00:00:00.000Z'
  });
  assert.equal(snapshot.network, 'preprod');
  assert.equal(snapshot.source.independentSourceCount, 2);
  assert.equal(snapshot.promotion.independentlyConfirmed, true);
  assert.equal(snapshot.tip.blockHash, tip.hash);
  assert.equal(snapshot.parameters.plutusV3CostModel.length, 350);
  const normalized = normalizeCardanoProtocolParameterSnapshot(snapshot);
  assert.equal(normalized.sourceCount, 2);
  assert.equal(normalized.independentlyConfirmed, true);
  assert.equal(normalized.maxTxExUnits.steps, 10000000000n);
  assert.equal(normalized.maxValueSize, 5000);
});

test('current Preprod protocol snapshot fails closed on any provider disagreement', () => {
  const changed = blockfrost();
  changed.min_fee_a = 45;
  assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
    ogmiosParameters: ogmios(), blockfrostParameters: changed, epoch: 400, tip
  }), /disagreement: minFeeA/);
});

test('current Preprod protocol snapshot fails closed on maxValueSize disagreement', () => {
  const changed = blockfrost();
  changed.max_val_size = '4999';
  assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
    ogmiosParameters: ogmios(), blockfrostParameters: changed, epoch: 400, tip
  }), /disagreement: maxValueSize/);
});

test('current Preprod protocol snapshot fails closed without raw Plutus V3 confirmation', () => {
  const changed = blockfrost();
  delete changed.cost_models_raw;
  assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
    ogmiosParameters: ogmios(), blockfrostParameters: changed, epoch: 400, tip
  }), /cost_models_raw/);
});

test('current Preprod protocol snapshot fails closed across an epoch disagreement', () => {
  assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
    ogmiosParameters: ogmios(), blockfrostParameters: blockfrost(), epoch: 401, tip
  }), /do not agree on the current Preprod epoch/);
});

test('live Cardano provider parsers reject coerced and imprecise integer inputs', () => {
  const cases = [
    p => { p.min_fee_a = true; },
    p => { p.min_fee_a = '44.0'; },
    p => { p.min_fee_b = Number.MAX_SAFE_INTEGER + 1; },
    p => { p.max_tx_size = '1e4'; },
    p => { p.max_collateral_inputs = '3.5'; },
    p => { p.cost_models_raw.PlutusV3 = [...model]; p.cost_models_raw.PlutusV3[0] = '1.5'; },
    p => { p.cost_models_raw.PlutusV3 = [...model]; p.cost_models_raw.PlutusV3[0] = true; },
    p => { p.cost_models_raw.PlutusV3 = [...model]; p.cost_models_raw.PlutusV3[0] = Number.MAX_SAFE_INTEGER + 1; }
  ];
  for (const mutate of cases) {
    const malformed = blockfrost();
    mutate(malformed);
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: malformed, epoch: 400, tip
    }));
  }
});


test('live Cardano execution prices reject implicit object, boolean, and nonfinite coercion', () => {
  for (const value of [true, false, {}, [], null, NaN, Infinity, -Infinity]) {
    const malformed = blockfrost();
    malformed.price_mem = value;
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: malformed, epoch: 400, tip
    }));
  }
});

test('live Cardano execution prices bound hostile decimal exponents and mantissas', () => {
  for (const value of ['1e1000000000', '1e-1000000000', '1'.repeat(1001)]) {
    const malformed = blockfrost();
    malformed.price_mem = value;
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: malformed, epoch: 400, tip
    }), /supported limit/);
  }
});

test('live Cardano stable tip hash rejects non-string coercion', () => {
  for (const hash of [null, 123, true, { toString: () => 'ab'.repeat(32) }]) {
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: blockfrost(), epoch: 400,
      tip: { hash, slot: tip.slot }
    }), /stable tip hash/);
  }
});

test('live Cardano snapshots reject malformed capture timestamps', () => {
  for (const capturedAt of [null, 123, 'not-a-date', '2026-10-05T00:00:00+00:00', '2026-02-30T00:00:00.000Z']) {
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: blockfrost(), epoch: 400, tip, capturedAt
    }), /capture timestamp/);
  }
});

test('live Cardano rational execution prices reject oversized numerator and denominator', () => {
  for (const price of [`${'1'.repeat(1001)}/2`, `1/${'9'.repeat(1001)}`]) {
    const changed = ogmios();
    changed.scriptExecutionPrices.memory = price;
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: changed, blockfrostParameters: blockfrost(), epoch: 400, tip
    }), /rational precision exceeds the supported limit/);
  }
});

test('live Cardano epoch provider rejects objects without an explicit epoch', () => {
  for (const epoch of [{}, { slot: 400 }, { epoch: undefined }]) {
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: blockfrost(), epoch, tip
    }), /epoch response must include an epoch/);
  }
});

test('live Cardano execution prices reject oversized decimal text before parsing', () => {
  for (const price of [' '.repeat(1200) + '0.1', '1'.repeat(1200)]) {
    const changed = blockfrost();
    changed.price_mem = price;
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: changed, epoch: 400, tip
    }), /decimal precision exceeds the supported limit/);
  }
});

test('live Cardano cost models reject oversized coefficient strings from either provider', () => {
  for (const oversized of ['9'.repeat(100000), '-' + '9'.repeat(100000)]) {
    const changedOgmios = ogmios();
    changedOgmios.plutusCostModels['plutus:v3'] = [...model];
    changedOgmios.plutusCostModels['plutus:v3'][0] = oversized;
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: changedOgmios, blockfrostParameters: blockfrost(), epoch: 400, tip
    }), /350-entry Plutus V3 cost model/);

    const changedBlockfrost = blockfrost();
    changedBlockfrost.cost_models_raw.PlutusV3 = [...model];
    changedBlockfrost.cost_models_raw.PlutusV3[0] = oversized;
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: changedBlockfrost, epoch: 400, tip
    }), /350-entry Plutus V3 cost model/);
  }
});
