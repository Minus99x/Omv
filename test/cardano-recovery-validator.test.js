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

test('Cardano heartbeat offline parity rejects immutable-policy mutation and unequal state value', () => {
  const datum = base();
  const next = createCardanoRecoveryDatum({ ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b], threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 110000, stateBeaconAsset: beacon });
  const args = { datum, signerKeyHashes: [owner], validityLowerBoundMs: 110000, inputValue: value, continuingOutputs: [{ address: 'script', value }], nextDatum: next };
  for (const changed of [
    { ...next, contactKeyHashes: [b, a] },
    { ...next, threshold: 1 },
    { ...next, inactivityMs: 1 },
    { ...next, version: 2 }
  ]) {
    assert.throws(() => validateCardanoHeartbeatTransition({ ...args, nextDatum: changed }), /Policy-critical fields are immutable/);
  }
  assert.throws(() => validateCardanoHeartbeatTransition({
    ...args, continuingOutputs: [{ address: 'script', value: { ...value, lovelace: '5000001' } }]
  }), /exact protected vault value/);
  const missingBeacon = { ...value };
  delete missingBeacon[beacon];
  assert.throws(() => validateCardanoHeartbeatTransition({ ...args, inputValue: missingBeacon }), /Protected state input must contain exactly one/);
});

test('Cardano approval offline parity rejects policy mutation and donation, preserving on-chain exact-state rule', () => {
  const datum = base();
  const next = createCardanoRecoveryDatum({ ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b], threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000, approvals: [a], stateBeaconAsset: beacon });
  const args = { datum, signerKeyHashes: [a], validityLowerBoundMs: 160000, inputValue: value, continuingOutputs: [{ address: 'script', value }], nextDatum: next };
  for (const changed of [
    { ...next, contactKeyHashes: [b, a] },
    { ...next, threshold: 1 },
    { ...next, inactivityMs: 1 },
    { ...next, version: 2 }
  ]) {
    assert.throws(() => validateCardanoApprovalTransition({ ...args, nextDatum: changed }), /Policy-critical fields are immutable/);
  }
  assert.throws(() => validateCardanoApprovalTransition({
    ...args, continuingOutputs: [{ address: 'script', value: { ...value, lovelace: '5000001' } }]
  }), /exact protected vault value/);
});

test('Cardano execute cannot pass offline parity without the state beacon in its input', () => {
  const datum = createCardanoRecoveryDatum({ ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b], threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000, approvals: [a, b], stateBeaconAsset: beacon });
  const missingBeacon = { ...value };
  delete missingBeacon[beacon];
  assert.throws(() => validateCardanoExecuteTransition({
    datum, validityLowerBoundMs: 160000, inputValue: missingBeacon,
    outputsToRescue: [{ address: rescue, value: missingBeacon }],
    mintedValue: { [beacon]: '-1' }
  }), /exactly one state beacon token in the protected input/);
});

test('Cardano inactivity comparison remains exact near safe-integer time bounds', () => {
  const datum = createCardanoRecoveryDatum({
    ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b], threshold: 2,
    inactivityMs: 10, lastHeartbeatMs: Number.MAX_SAFE_INTEGER - 5, stateBeaconAsset: beacon
  });
  assert.equal(cardanoRecoveryEligible(datum, Number.MAX_SAFE_INTEGER), false);
});

test('Cardano approval mirrors one Aiken Approve(contact) per transition despite multiple signatures', () => {
  const datum = base();
  const nextSingle = createCardanoRecoveryDatum({
    ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b],
    threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000,
    approvals: [a], stateBeaconAsset: beacon
  });
  const nextBoth = createCardanoRecoveryDatum({
    ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b],
    threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000,
    approvals: [a, b], stateBeaconAsset: beacon
  });
  const args = {
    datum, signerKeyHashes: [a, b], validityLowerBoundMs: 160000,
    inputValue: value, continuingOutputs: [{ address: 'script', value }]
  };
  assert.throws(() => validateCardanoApprovalTransition({ ...args, nextDatum: nextBoth }), /explicit redeemer-selected/);
  assert.throws(() => validateCardanoApprovalTransition({
    ...args, approvedContactKeyHash: a, nextDatum: nextBoth
  }), /do not exactly match/);
  const result = validateCardanoApprovalTransition({
    ...args, approvedContactKeyHash: a, nextDatum: nextSingle
  });
  assert.equal(result.approvals, 1);
  assert.throws(() => validateCardanoApprovalTransition({
    ...args, approvedContactKeyHash: owner, nextDatum: nextSingle
  }), /configured, not-yet-approved trusted contact/);
  assert.throws(() => validateCardanoApprovalTransition({
    ...args, approvedContactKeyHash: '88'.repeat(28), nextDatum: nextSingle
  }), /configured, not-yet-approved trusted contact/);
});

test('Cardano approval does not credit an already-approved contact or unsigned selected contact', () => {
  const datum = createCardanoRecoveryDatum({
    ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b],
    threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000,
    approvals: [a], stateBeaconAsset: beacon
  });
  const next = createCardanoRecoveryDatum({
    ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b],
    threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000,
    approvals: [a, b], stateBeaconAsset: beacon
  });
  const args = {
    datum, signerKeyHashes: [a, b], validityLowerBoundMs: 160000,
    inputValue: value, continuingOutputs: [{ address: 'script', value }], nextDatum: next
  };
  assert.throws(() => validateCardanoApprovalTransition({
    ...args, approvedContactKeyHash: a
  }), /configured, not-yet-approved trusted contact/);
  assert.throws(() => validateCardanoApprovalTransition({
    ...args, signerKeyHashes: [a], approvedContactKeyHash: b
  }), /at least one new trusted-contact signature/);
  assert.equal(validateCardanoApprovalTransition({
    ...args, approvedContactKeyHash: b
  }).approvals, 2);
});

test('Cardano offline validators reject negative UTxO quantities before a recovery transition can pass', () => {
  const datum = base();
  const next = createCardanoRecoveryDatum({
    ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b],
    threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 110000, stateBeaconAsset: beacon
  });
  const args = {
    datum, signerKeyHashes: [owner], validityLowerBoundMs: 110000,
    inputValue: value, continuingOutputs: [{ address: 'script', value }], nextDatum: next
  };
  assert.throws(() => validateCardanoHeartbeatTransition({
    ...args, inputValue: { ...value, lovelace: '-1' }
  }), /must not be negative in a UTxO value/);
  assert.throws(() => validateCardanoHeartbeatTransition({
    ...args, continuingOutputs: [{ address: 'script', value: { ...value, [`${h(5)}.aa`]: '-5' } }]
  }), /must not be negative in a UTxO value/);
});

test('Cardano offline validators reject duplicate canonical asset IDs and imprecise numeric quantities', () => {
  const datum = base();
  const next = createCardanoRecoveryDatum({
    ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b],
    threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 110000, stateBeaconAsset: beacon
  });
  const args = {
    datum, signerKeyHashes: [owner], validityLowerBoundMs: 110000,
    inputValue: value, continuingOutputs: [{ address: 'script', value }], nextDatum: next
  };
  const token = `${h(5)}.aa`;
  assert.throws(() => validateCardanoHeartbeatTransition({
    ...args, inputValue: { ...value, [token.toUpperCase()]: '999' }
  }), /duplicate asset IDs/);
  assert.throws(() => validateCardanoHeartbeatTransition({
    ...args, inputValue: { ...value, lovelace: Number.MAX_SAFE_INTEGER + 1 }
  }), /safe integer/);
});

test('Cardano state beacon burn remains valid as a signed mint quantity', () => {
  const datum = createCardanoRecoveryDatum({
    ownerKeyHash: owner, rescueAddress: rescue, contactKeyHashes: [a, b],
    threshold: 2, inactivityMs: 60000, lastHeartbeatMs: 100000,
    approvals: [a, b], stateBeaconAsset: beacon
  });
  const rescued = { ...value };
  delete rescued[beacon];
  assert.equal(validateCardanoExecuteTransition({
    datum, validityLowerBoundMs: 160000,
    inputValue: value, outputsToRescue: [{ address: rescue, value: rescued }],
    mintedValue: { [beacon]: '-1' }
  }).stateBeaconBurned, true);
});
