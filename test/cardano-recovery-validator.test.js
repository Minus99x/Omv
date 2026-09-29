import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectCardanoRecoveryMechanism, createCardanoRecoveryDatum, cardanoRecoveryEligible,
  validateCardanoHeartbeatTransition, validateCardanoApprovalTransition, validateCardanoExecuteTransition,
  createCardanoTransactionPreflightPlan, createCardanoStateBeaconPlan, calculateCardanoMinRequiredLovelace
} from '../src/chains/cardano/recovery-validator.js';

const h = n => String(n).repeat(56);
const owner = h(1), a = h(2), b = h(3);
const beacon = `${h(4)}.01`;
const rescue = 'addr_test1_omegavault_rescue';
const base = () => createCardanoRecoveryDatum({ ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b], threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000, stateBeaconAsset: beacon });
const value = { lovelace: '5000000', [beacon]: '1', [`${h(5)}.aa`]: '12' };

test('Cardano exact-semantics path selects a Plutus-family validator rather than pretending native scripts can enforce rescue/state', () => {
  const selected = selectCardanoRecoveryMechanism();
  assert.equal(selected.nativeScriptSuitableForExactOmegaVault, false);
  assert.match(selected.exactMechanism, /Plutus\/Aiken/);
});

test('Cardano heartbeat requires owner, preserves value/policy and clears approvals', () => {
  const datum = { ...base(), approvals: [a] };
  const next = createCardanoRecoveryDatum({ ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b], threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 110000, stateBeaconAsset: beacon });
  const result = validateCardanoHeartbeatTransition({ datum, signerKeyHashes: [owner], validityLowerBoundMs: 110000, inputValue: value, continuingOutputs: [{ address: 'script', value }], nextDatum: next });
  assert.equal(result.ok, true);
  assert.throws(() => validateCardanoHeartbeatTransition({ datum, signerKeyHashes: [a], validityLowerBoundMs: 110000, inputValue: value, continuingOutputs: [{ address: 'script', value }], nextDatum: next }), /owner signature/);
});

test('Cardano approval transition is inactivity-gated and accumulates only configured contact signatures', () => {
  const datum = base();
  assert.equal(cardanoRecoveryEligible(datum, 159999), false);
  const next = createCardanoRecoveryDatum({ ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b], threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000, approvals: [a], stateBeaconAsset: beacon });
  const result = validateCardanoApprovalTransition({ datum, signerKeyHashes: [a], validityLowerBoundMs: 160000, inputValue: value, continuingOutputs: [{ address: 'script', value }], nextDatum: next });
  assert.equal(result.approvals, 1);
});

test('Cardano execute path requires threshold and full protected value at immutable rescue address', () => {
  const datum = createCardanoRecoveryDatum({ ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b], threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000, approvals: [a, b], stateBeaconAsset: beacon });
  const rescuedValue = { lovelace: '5000000', [`${h(5)}.aa`]: '12' };
  const result = validateCardanoExecuteTransition({ datum, validityLowerBoundMs: 160000, inputValue: value, outputsToRescue: [{ address: rescue, value: rescuedValue }], mintedValue: { [beacon]: '-1' } });
  assert.equal(result.ok, true);
  assert.equal(result.stateBeaconBurned, true);
  assert.throws(() => validateCardanoExecuteTransition({ datum, validityLowerBoundMs: 160000, inputValue: value, outputsToRescue: [{ address: 'addr_test1_wrong', value: rescuedValue }], mintedValue: { [beacon]: '-1' } }), /immutable rescue/);
  assert.throws(() => validateCardanoExecuteTransition({ datum, validityLowerBoundMs: 160000, inputValue: value, outputsToRescue: [{ address: rescue, value: { lovelace: '4000000', [`${h(5)}.aa`]: '12' } }], mintedValue: { [beacon]: '-1' } }), /exact protected vault value/);
  assert.throws(() => validateCardanoExecuteTransition({ datum, validityLowerBoundMs: 160000, inputValue: value, outputsToRescue: [{ address: rescue, value: rescuedValue }], mintedValue: { [beacon]: '0' } }), /burn exactly one/);
});

test('Cardano state beacon lifecycle is one-shot at creation and burned at recovery', () => {
  const plan = createCardanoStateBeaconPlan({ seedTxId: 'ab'.repeat(32), seedOutputIndex: 0 });
  assert.equal(plan.initialization.seedMustBeSpent, true);
  assert.equal(plan.initialization.exactQuantity, 1);
  assert.equal(plan.recovery.exactQuantity, -1);
  assert.equal(plan.recovery.recreateBeaconOutput, false);
});

test('Cardano minimum-ADA calculation is parameterized by current protocol parameters', () => {
  const calculation = calculateCardanoMinRequiredLovelace({ serializedOutputBytes: 200, coinsPerUtxoByte: '4310' });
  assert.equal(calculation.minimumLovelace, '1551600');
  assert.equal(calculation.requiresCurrentProtocolParameters, true);
  assert.throws(() => calculateCardanoMinRequiredLovelace({ serializedOutputBytes: 200, coinsPerUtxoByte: 0 }), /positive integer/);
});

test('Cardano preflight requires external fee/collateral design and body recomputation after changes', () => {
  const plan = createCardanoTransactionPreflightPlan({});
  assert.ok(plan.requiredChecks.some(x => /minimum-ADA/gi.test(x)));
  assert.ok(plan.requiredChecks.some(x => /collateral/gi.test(x)));
  assert.ok(plan.requiredChecks.some(x => /recomputed/gi.test(x)));
});
