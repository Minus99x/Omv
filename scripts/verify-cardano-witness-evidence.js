import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { normalizeCardanoProtocolParameterSnapshot, createCardanoProtocolParameterGate } from '../src/chains/cardano/protocol-parameters.js';
import { buildCardanoOgmiosEvaluationFixture, buildCardanoWitnessSetFixture } from '../src/chains/cardano/witness-set.js';
import { createCardanoOgmiosEvaluationRequest } from '../src/chains/cardano/ogmios-evaluation.js';

const root = new URL('../', import.meta.url);
const protocolEvidence = JSON.parse(await readFile(new URL('docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', root), 'utf8'));
const witnessEvidence = JSON.parse(await readFile(new URL('docs/evidence/CARDANO_WITNESS_FIXTURES_0.6.14.json', root), 'utf8'));
const beaconBlueprint = JSON.parse(await readFile(new URL('validators/cardano/fixtures/state-beacon.applied.json', root), 'utf8'));
const vaultBlueprint = JSON.parse(await readFile(new URL('validators/cardano/fixtures/recovery-vault.applied.json', root), 'utf8'));
const parameters = normalizeCardanoProtocolParameterSnapshot(protocolEvidence);
const gate = createCardanoProtocolParameterGate([parameters]);
const beaconCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;
const sha256Hex = value => createHash('sha256').update(Buffer.from(value, 'hex')).digest('hex');

assert.equal(gate.liveConstructionReady, false);
assert.equal(witnessEvidence.liveConstructionReady, false);
assert.equal(witnessEvidence.costModelSourceCount, 1);

const correctedFixtures = {};
for (const action of ['initialize', 'heartbeat', 'approve', 'execute']) {
  const actual = buildCardanoWitnessSetFixture({ action, parameters, recoveryCompiledCode: recoveryCode, beaconCompiledCode: beaconCode });
  const evaluationFixture = buildCardanoOgmiosEvaluationFixture({ action, parameters, recoveryCompiledCode: recoveryCode, beaconCompiledCode: beaconCode });
  const evaluationRequest = createCardanoOgmiosEvaluationRequest({ transactionCborHex: evaluationFixture.transactionCborHex, id: `evaluate-${action}` });
  correctedFixtures[action] = {
    scriptDataHash: actual.scriptDataHash,
    witnessSetBytes: actual.witnessSetBytes,
    witnessSetSha256: sha256Hex(actual.witnessSetCborHex),
    transactionBytes: actual.transactionBytes,
    transactionSha256: sha256Hex(actual.transactionCborHex),
    minimumFee: actual.minimumFee,
    memory: actual.memory,
    steps: actual.steps,
    keyWitnessCount: actual.keyWitnessCount,
    feeConvergenceIterations: actual.feeConvergenceIterations,
    minimumAda: actual.minimumAda,
    collateral: actual.collateral,
    evaluationTransactionBodyHash: evaluationRequest.transactionBodyHash,
    evaluationValidators: evaluationRequest.expectedValidators
  };
}
console.log(`CARDANO_WITNESS_CORRECTION_FIXTURES=${JSON.stringify(correctedFixtures)}`);

for (const action of ['initialize', 'heartbeat', 'approve', 'execute']) {
  const actual = buildCardanoWitnessSetFixture({ action, parameters, recoveryCompiledCode: recoveryCode, beaconCompiledCode: beaconCode });
  const expected = witnessEvidence.fixtures[action];
  assert.equal(actual.scriptDataHash, expected.scriptDataHash);
  assert.equal(actual.witnessSetBytes, expected.witnessSetBytes);
  assert.equal(sha256Hex(actual.witnessSetCborHex), expected.witnessSetSha256);
  assert.equal(actual.transactionBytes, expected.transactionBytes);
  assert.equal(sha256Hex(actual.transactionCborHex), expected.transactionSha256);
  assert.equal(actual.minimumFee, expected.minimumFee);
  assert.equal(actual.memory, expected.memory);
  assert.equal(actual.steps, expected.steps);
  assert.equal(actual.keyWitnessCount, expected.keyWitnessCount);
  assert.equal(actual.feeConvergenceIterations, expected.feeConvergenceIterations);
  assert.deepEqual(actual.minimumAda, expected.minimumAda);
  assert.deepEqual(actual.collateral, expected.collateral);
  const evaluationFixture = buildCardanoOgmiosEvaluationFixture({ action, parameters, recoveryCompiledCode: recoveryCode, beaconCompiledCode: beaconCode });
  const evaluationRequest = createCardanoOgmiosEvaluationRequest({ transactionCborHex: evaluationFixture.transactionCborHex, id: `evaluate-${action}` });
  assert.equal(evaluationRequest.transactionBodyHash, expected.evaluationTransactionBodyHash);
  assert.deepEqual(evaluationRequest.expectedValidators, expected.evaluationValidators);
}

console.log('Verified Cardano signed-size/fee/minimum-ADA/collateral evidence and zero-budget Ogmios evaluation requests; live construction remains blocked.');
