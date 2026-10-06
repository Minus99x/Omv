import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDANO_APPLIED_FIXTURE,
  buildCardanoEvaluationAdditionalUtxoSet,
  buildCardanoTransactionBodyFixture,
  cardanoPreprodSlotToUnixTimeMs,
  createCardanoVaultDatumData,
  deriveCardanoEnterpriseScriptAddress
} from '../src/chains/cardano/transaction-body.js';

test('Cardano applied fixture derives the exact Aiken Preprod enterprise script address', () => {
  assert.equal(
    deriveCardanoEnterpriseScriptAddress({ scriptHash: CARDANO_APPLIED_FIXTURE.recoveryValidatorHash }),
    CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress
  );
  assert.equal(CARDANO_APPLIED_FIXTURE.deployable, false);
});

test('Cardano datum encoder emits constructor CBOR and rejects unconfigured approvals', () => {
  const datum = createCardanoVaultDatumData({
    ownerKeyHash: '11'.repeat(28),
    rescueKeyHash: '66'.repeat(28),
    contactKeyHashes: ['22'.repeat(28), '33'.repeat(28)],
    threshold: 2,
    inactivityMs: 60000,
    lastHeartbeatMs: 1000000,
    approvalKeyHashes: ['22'.repeat(28)]
  });
  assert.ok(datum.to_hex().startsWith('d879'));
  assert.throws(() => createCardanoVaultDatumData({
    ownerKeyHash: '11'.repeat(28), rescueKeyHash: '66'.repeat(28), contactKeyHashes: ['22'.repeat(28)],
    threshold: 1, inactivityMs: 1, lastHeartbeatMs: 0, approvalKeyHashes: ['44'.repeat(28)]
  }), /not a configured contact/);
});

for (const action of ['initialize', 'heartbeat', 'approve', 'execute']) {
  test(`Cardano ${action} transaction body round-trips exact canonical CBOR`, () => {
    const fixture = buildCardanoTransactionBodyFixture(action);
    assert.equal(fixture.roundTripExact, true);
    assert.equal(fixture.networkId, 0);
    assert.equal(fixture.inputCount, 2);
    assert.ok(fixture.outputCount >= 2);
    assert.match(fixture.bodyHashHex, /^[0-9a-f]{64}$/);
    assert.equal(fixture.hasCollateral, true);
    assert.equal(fixture.requiresLiveProtocolParameters, true);
    assert.equal(fixture.scriptDataHashIsFixtureOnly, true);
  });
}



test('Cardano Preprod slot fixture maps to stable POSIX time for validator context', () => {
  assert.equal(cardanoPreprodSlotToUnixTimeMs(86400), 1655769600000);
  assert.ok(cardanoPreprodSlotToUnixTimeMs(100000100) > 1655769600000);
});

for (const action of ['initialize', 'heartbeat', 'approve', 'execute']) {
  test(`Cardano ${action} evaluation context provides every synthetic input in Ogmios v7 UTxO shape`, () => {
    const utxo = buildCardanoEvaluationAdditionalUtxoSet(action);
    assert.equal(utxo.length, 3);
    for (const entry of utxo) {
      assert.match(entry.transaction.id, /^[0-9a-f]{64}$/);
      assert.ok(Number.isInteger(entry.index));
      assert.match(entry.address, /^addr_test1/);
      assert.ok(Number.isSafeInteger(entry.value.ada.lovelace));
    }
    const scriptEntry = action === 'initialize' ? null : utxo[0];
    if (scriptEntry) {
      assert.equal(scriptEntry.address, CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress);
      assert.match(scriptEntry.datum, /^[0-9a-f]+$/i);
      assert.equal(scriptEntry.value[CARDANO_APPLIED_FIXTURE.beaconPolicyId][CARDANO_APPLIED_FIXTURE.assetNameHex], 1);
    }
  });
}
