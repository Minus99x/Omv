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

test('live Cardano provider integers reject oversized decimal strings before BigInt parsing', () => {
  const huge = '9'.repeat(100000);
  for (const field of ['min_fee_a', 'min_fee_b', 'coins_per_utxo_size', 'max_tx_ex_steps']) {
    const changed = blockfrost();
    changed[field] = huge;
    assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
      ogmiosParameters: ogmios(), blockfrostParameters: changed, epoch: 400, tip
    }), /integer precision exceeds the supported limit/);
  }
  const changedOgmios = ogmios();
  changedOgmios.minFeeCoefficient = huge;
  assert.throws(() => createCardanoPreprodLiveProtocolSnapshot({
    ogmiosParameters: changedOgmios, blockfrostParameters: blockfrost(), epoch: 400, tip
  }), /integer precision exceeds the supported limit/);
});

test('live protocol capture preserves complete provider document without caller aliasing', () => {
  const provider=blockfrost();provider.extra_provider_field='2000000';
  const snapshot=createCardanoPreprodLiveProtocolSnapshot({ogmiosParameters:ogmios(),blockfrostParameters:provider,epoch:400,tip,capturedAt:'2026-10-06T00:00:00.000Z'});
  assert.deepEqual(snapshot.capturedBlockfrostParameters,provider);
  provider.extra_provider_field='1';provider.cost_models_raw.PlutusV3=[0];
  assert.equal(snapshot.capturedBlockfrostParameters.extra_provider_field,'2000000');
  assert.equal(snapshot.capturedBlockfrostParameters.cost_models_raw.PlutusV3.length,350);
  assert.throws(()=>{snapshot.capturedBlockfrostParameters.cost_models_raw.PlutusV3[0]=99;},TypeError);
});

const extendedPairs = [
  ['key_deposit', 'stakeCredentialDeposit', {ada:{lovelace:2000000}}, '2000000'],
  ['pool_deposit', 'stakePoolDeposit', {lovelace:500000000}, '500000000'],
  ['min_pool_cost', 'minStakePoolCost', {ada:{lovelace:170000000}}, '170000000'],
  ['max_block_size', 'maxBlockBodySize', {bytes:90112}, 90112],
  ['max_block_header_size', 'maxBlockHeaderSize', {bytes:1100}, 1100],
  ['e_max', 'stakePoolRetirementEpochBound', 18, 18],
  ['n_opt', 'desiredNumberOfStakePools', 500, 500],
  ['a0', 'stakePoolPledgeInfluence', '3/10', 0.3],
  ['rho', 'monetaryExpansion', '3/1000', 0.003],
  ['tau', 'treasuryExpansion', '1/5', 0.2],
  ['max_block_ex_mem', 'maxExecutionUnitsPerBlock.memory', 62000000, '62000000'],
  ['max_block_ex_steps', 'maxExecutionUnitsPerBlock.cpu', 20000000000, '20000000000']
];
function extendedFixture() {
  const o=ogmios(), b=blockfrost();
  for(const [field,path,value,raw] of extendedPairs) {
    const keys=path.split('.');
    if(keys.length===2) (o[keys[0]]??={})[keys[1]]=structuredClone(value);
    else o[path]=structuredClone(value);
    b[field]=raw;
  }
  return {ogmiosParameters:o,blockfrostParameters:b,epoch:400,tip};
}
test('extended parameters compare exact amounts, sizes and equivalent rationals and retain frozen Ogmios evidence',()=>{
  const input=extendedFixture();const snapshot=createCardanoPreprodLiveProtocolSnapshot(input);
  assert.deepEqual(snapshot.confirmedAdditionalFields,extendedPairs.map(x=>x[0]));
  input.ogmiosParameters.stakeCredentialDeposit.ada.lovelace=1;
  assert.equal(snapshot.capturedOgmiosParameters.stakeCredentialDeposit.ada.lovelace,2000000);
  assert.throws(()=>{snapshot.capturedOgmiosParameters.stakeCredentialDeposit.ada.lovelace=1;},TypeError);
});
for(const [field,path] of extendedPairs) {
  test(`extended ${field} rejects disagreement, missing and invalid provider evidence`,()=>{
    for(const bad of ['1',null,undefined,-1,Number.MAX_SAFE_INTEGER+1]) {
      const input=extendedFixture();input.blockfrostParameters[field]=bad;
      assert.throws(()=>createCardanoPreprodLiveProtocolSnapshot(input));
    }
    const input=extendedFixture(),keys=path.split('.');
    if(keys.length===2) delete input.ogmiosParameters[keys[0]][keys[1]];
    else delete input.ogmiosParameters[path];
    assert.throws(()=>createCardanoPreprodLiveProtocolSnapshot(input));
  });
}
test('replay agreement recomputes additional checks instead of trusting a stored field list',async()=>{
  const {verifyCapturedBlockfrostAgreement}=await import('../src/chains/cardano/live-protocol-parameters.js');
  const snapshot=structuredClone(createCardanoPreprodLiveProtocolSnapshot(extendedFixture()));
  assert.equal(verifyCapturedBlockfrostAgreement(snapshot,snapshot.capturedBlockfrostParameters),true);
  snapshot.confirmedAdditionalFields=[];
  snapshot.capturedBlockfrostParameters.key_deposit='1';
  assert.throws(()=>verifyCapturedBlockfrostAgreement(snapshot,snapshot.capturedBlockfrostParameters),/disagreement: key_deposit/);
});
