import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { buildCardanoOgmiosEvaluationFixture, buildCardanoWitnessSetFixture } from '../src/chains/cardano/witness-set.js';

const evidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
const parameters = normalizeCardanoProtocolParameterSnapshot(evidence);
const beacon = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vault = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCode = beacon.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCode = vault.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;

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
