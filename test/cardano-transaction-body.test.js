import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import {
  CARDANO_APPLIED_FIXTURE,
  buildCardanoEvaluationAdditionalUtxoSet,
  buildCardanoTransactionBodyFixture,
  cardanoPreprodSlotToUnixTimeMs,
  createCardanoVaultDatumData,
  deriveCardanoEnterpriseScriptAddress
} from '../src/chains/cardano/transaction-body.js';

function assertFixtureAdaBalance(action, feeLovelace) {
  const fixture = buildCardanoTransactionBodyFixture(action, { feeLovelace });
  const utxos = buildCardanoEvaluationAdditionalUtxoSet(action, { feeLovelace });
  const body = Cardano.TransactionBody.from_bytes(Buffer.from(fixture.cborHex, 'hex'));
  let inputLovelace = 0n;
  let outputLovelace = 0n;

  for (let index = 0; index < body.inputs().len(); index += 1) {
    const input = body.inputs().get(index);
    const txId = input.transaction_id().to_hex();
    const utxo = utxos.find(entry => entry.transaction.id === txId && entry.index === input.index());
    assert.ok(utxo, `missing evaluation UTxO for ${txId}#${input.index()}`);
    inputLovelace += BigInt(utxo.value.ada.lovelace);
  }

  for (let index = 0; index < body.outputs().len(); index += 1) {
    outputLovelace += BigInt(body.outputs().get(index).amount().coin().to_str());
  }
  assert.equal(inputLovelace, outputLovelace + BigInt(body.fee().to_str()));
}

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

test('Cardano datum encoder keeps owner, rescue, and trusted-contact roles distinct', () => {
  const base = {
    ownerKeyHash: '11'.repeat(28),
    rescueKeyHash: '66'.repeat(28),
    contactKeyHashes: ['22'.repeat(28), '33'.repeat(28)],
    threshold: 2,
    inactivityMs: 60000,
    lastHeartbeatMs: 1000000
  };

  assert.ok(createCardanoVaultDatumData(base).to_hex().startsWith('d879'));
  assert.throws(
    () => createCardanoVaultDatumData({ ...base, rescueKeyHash: '11'.repeat(28).toUpperCase() }),
    /owner cannot also be the rescue destination/
  );
  assert.throws(
    () => createCardanoVaultDatumData({ ...base, contactKeyHashes: ['11'.repeat(28), '33'.repeat(28)] }),
    /owner cannot also be a trusted contact/
  );
  assert.throws(
    () => createCardanoVaultDatumData({ ...base, contactKeyHashes: ['66'.repeat(28), '33'.repeat(28)] }),
    /rescue destination cannot also be a trusted contact/
  );
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

test('Cardano Preprod slot conversion rejects lossy POSIX milliseconds at the safe-integer boundary', () => {
  const maxSafeSlot = 86400 + Math.floor(
    (Number.MAX_SAFE_INTEGER - 1655769600000) / 1000
  );
  assert.ok(Number.isSafeInteger(cardanoPreprodSlotToUnixTimeMs(maxSafeSlot)));
  assert.throws(
    () => cardanoPreprodSlotToUnixTimeMs(maxSafeSlot + 1),
    /outside the safe POSIX millisecond range/
  );
  assert.throws(
    () => buildCardanoTransactionBodyFixture('execute', {
      evaluationContext: true,
      evaluationSlot: Number.MAX_SAFE_INTEGER
    }),
    /outside the safe POSIX millisecond range/
  );
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


test('public Preprod evaluation validity window is anchored to the captured live tip slot', () => {
  const tipSlot = 200000000;
  const fixture = buildCardanoTransactionBodyFixture('execute', {
    evaluationContext: true,
    evaluationSlot: tipSlot
  });
  assert.equal(fixture.evaluationContext, true);
  assert.equal(fixture.validity.liveTipSlot, tipSlot);
  assert.equal(fixture.validity.lowerSlot, tipSlot - 30);
  assert.equal(fixture.validity.upperSlot, tipSlot + 1800);
  assert.equal(fixture.validity.priorHeartbeatMs, fixture.validity.lowerTimeMs - 60000);
});

test('public Preprod supplemental vault datum is rebound when the live evaluation tip changes', () => {
  const first = buildCardanoEvaluationAdditionalUtxoSet('execute', { evaluationSlot: 200000000 });
  const second = buildCardanoEvaluationAdditionalUtxoSet('execute', { evaluationSlot: 200000120 });
  assert.notEqual(first[0].datum, second[0].datum);
  assert.equal(first[0].transaction.id, second[0].transaction.id);
});

test('live evaluation slot cannot leak into the offline fixture transaction path', () => {
  assert.throws(
    () => buildCardanoTransactionBodyFixture('execute', { evaluationSlot: 200000000 }),
    /only valid for a public Preprod evaluation context/
  );
});

test('Cardano transaction fixtures balance ADA inputs, outputs, and fees', () => {
  for (const action of ['initialize', 'heartbeat', 'approve', 'execute']) {
    assertFixtureAdaBalance(action, '200000');
    assertFixtureAdaBalance(action, '750000');
  }
});

test('Cardano fixture fee inputs reject malformed and unsafe quantities', () => {
  for (const feeLovelace of ['0', '-1', '1.5', String(Number.MAX_SAFE_INTEGER)]) {
    assert.throws(
      () => buildCardanoEvaluationAdditionalUtxoSet('initialize', { feeLovelace }),
      /feeLovelace/
    );
    assert.throws(
      () => buildCardanoTransactionBodyFixture('initialize', { feeLovelace }),
      /feeLovelace/
    );
  }
});
