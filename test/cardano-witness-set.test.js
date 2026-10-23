import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { readFileSync } from 'node:fs';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import {
  buildCardanoOgmiosEvaluationFixture,
  buildCardanoWitnessSetFixture,
  createCardanoPlutusV3CostModels
} from '../src/chains/cardano/witness-set.js';

const evidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
const parameters = normalizeCardanoProtocolParameterSnapshot(evidence);
const beacon = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vault = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCode = beacon.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCode = vault.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;

test('Cardano Plutus V3 cost-model construction requires 350 dense, valid integer entries', () => {
  const valid = [...parameters.plutusV3CostModel];
  const models = createCardanoPlutusV3CostModels(valid);
  assert.equal(models.get(Cardano.Language.new_plutus_v3()).len(), 350);

  const sparse = [...valid];
  delete sparse[174];
  assert.throws(() => createCardanoPlutusV3CostModels(sparse), /complete 350-entry/);
  for (const invalid of [NaN, Infinity, 1.5, '1.5', '1e3', true, null]) {
    const malformed = [...valid];
    malformed[174] = invalid;
    assert.throws(() => createCardanoPlutusV3CostModels(malformed), /integer/);
  }
  const excessive = [...valid];
  excessive[174] = '9'.repeat(1001);
  assert.throws(() => createCardanoPlutusV3CostModels(excessive), /supported precision/);
});

for (const action of ['initialize', 'heartbeat', 'approve', 'execute']) {
  test(`Cardano ${action} script-data hash and witness set round-trip`, () => {
    const result = buildCardanoWitnessSetFixture({ action, parameters, recoveryCompiledCode: recoveryCode, beaconCompiledCode: beaconCode });
    assert.match(result.scriptDataHash, /^[0-9a-f]{64}$/);
    assert.equal(result.roundTripExact, true);
    assert.ok(result.witnessSetBytes > 0);
    assert.ok(result.transactionBytes > result.witnessSetBytes);
    assert.equal(result.requiresIndependentLiveEvaluation, true);
    assert.equal(result.keyWitnessSizingComplete, true);
    assert.equal(result.feeIncludesKeyWitnesses, true);
    assert.equal(result.keyWitnessCount, action === 'approve' ? 2 : 1);
    assert.ok(result.feeConvergenceIterations >= 2);
    assert.ok(result.minimumAda.every(output => output.satisfied));
    assert.equal(result.collateral.satisfied, true);
  });
}

test('Cardano Ogmios evaluation fixture zeroes every redeemer budget and omits key witnesses', () => {
  const result = buildCardanoOgmiosEvaluationFixture({ action: 'execute', parameters, recoveryCompiledCode: recoveryCode, beaconCompiledCode: beaconCode });
  assert.equal(result.evaluationCandidate, true);
  assert.equal(result.memory, '0');
  assert.equal(result.steps, '0');
  assert.equal(result.keyWitnessCount, 0);
  assert.equal(result.feeIncludesKeyWitnesses, false);
});

test('Cardano evaluated redeemer budgets are bounded before CSL witness construction', () => {
  const buildWithBudget = budgetOverrides => buildCardanoWitnessSetFixture({
    action: 'execute',
    parameters,
    recoveryCompiledCode: recoveryCode,
    beaconCompiledCode: beaconCode,
    budgetOverrides
  });

  assert.throws(
    () => buildWithBudget({
      'mint:0': { memory: (parameters.maxTxExUnits.memory + 1n).toString(), steps: '1' },
      'spend:0': { memory: '1', steps: '1' }
    }),
    /mint:0\.memory exceeds current maxTxExUnits/
  );
  assert.throws(
    () => buildWithBudget({
      'mint:0': { memory: '1', steps: '1' },
      'spend:0': { memory: '1', steps: '9'.repeat(1001) }
    }),
    /integer precision exceeds the supported limit/
  );
  const overLimitPerRedeemer = parameters.maxTxExUnits.memory / 2n + 1n;
  assert.throws(
    () => buildWithBudget({
      'mint:0': { memory: overLimitPerRedeemer.toString(), steps: '1' },
      'spend:0': { memory: overLimitPerRedeemer.toString(), steps: '1' }
    }),
    /Execution units exceed current maxTxExUnits/
  );
});

test('Cardano evaluated redeemer budgets within protocol limits construct a sized transaction', () => {
  const result = buildCardanoWitnessSetFixture({
    action: 'execute',
    parameters,
    recoveryCompiledCode: recoveryCode,
    beaconCompiledCode: beaconCode,
    budgetOverrides: {
      'mint:0': { memory: '1', steps: '1' },
      'spend:0': { memory: '1', steps: '1' }
    }
  });
  assert.equal(result.executionUnitsFromLiveEvaluation, true);
  assert.equal(result.memory, '2');
  assert.equal(result.steps, '2');
  assert.equal(result.roundTripExact, true);
});
