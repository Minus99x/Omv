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
});

test('current Preprod protocol snapshot fails closed on any provider disagreement', () => {
  const changed = blockfrost();
  changed.min_fee_a = 45;
  assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
    ogmiosParameters: ogmios(), blockfrostParameters: changed, epoch: 400, tip
  }), /disagreement: minFeeA/);
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
