import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import {
  CARDANO_APPLIED_FIXTURE,
  CARDANO_PREPROD_NETWORK_ID
} from '../src/chains/cardano/transaction-body.js';
import {
  createCardanoPreprodRealUtxoBindingEvidence,
  createCardanoPreprodRealUtxoBindingPlan,
  verifyCardanoPreprodRealUtxoBindingEvidence
} from '../src/chains/cardano/preprod-real-utxo-binding.js';

function walletAddress(keyByte) {
  const hash = Cardano.Ed25519KeyHash.from_hex(keyByte.repeat(28));
  return Cardano.EnterpriseAddress
    .new(CARDANO_PREPROD_NETWORK_ID, Cardano.Credential.from_keyhash(hash))
    .to_address()
    .to_bech32();
}

const ownerAddress = walletAddress('11');

function ref(byte, index) {
  return { transaction: { id: byte.repeat(32) }, index };
}

function walletUtxo(reference, lovelace) {
  return {
    ...reference,
    address: ownerAddress,
    value: { ada: { lovelace: String(lovelace) } }
  };
}

test('Cardano real initialize UTxO plan binds distinct seed/fee/collateral references only', () => {
  const plan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles: {
      seed: ref('aa', 0),
      fee: ref('bb', 1),
      collateral: ref('cc', 2)
    }
  });
  assert.equal(plan.network, 'preprod');
  assert.equal(plan.networkId, 0);
  assert.deepEqual(Object.keys(plan.roles), ['seed', 'fee', 'collateral']);
  assert.equal(plan.query.method, 'queryLedgerState/utxo');
  assert.equal(plan.query.params.outputReferences.length, 3);
  assert.equal(plan.walletSigningAuthorized, false);
  assert.equal(plan.transactionSubmissionAuthorized, false);
  assert.match(plan.planSha256, /^[0-9a-f]{64}$/);

  assert.throws(
    () => createCardanoPreprodRealUtxoBindingPlan({
      action: 'initialize',
      roles: {
        seed: ref('aa', 0),
        fee: ref('aa', 0),
        collateral: ref('cc', 2)
      }
    }),
    /distinct/
  );
});

test('Cardano real initialize UTxO evidence accepts exact stable-tip ADA-only role set', () => {
  const plan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles: {
      seed: ref('aa', 0),
      fee: ref('bb', 1),
      collateral: ref('cc', 2)
    }
  });
  const tip = { hash: 'dd'.repeat(32), slot: 135700000 };
  const queriedUtxo = [
    walletUtxo(plan.roles.seed, 10000000),
    walletUtxo(plan.roles.fee, 3000000),
    walletUtxo(plan.roles.collateral, 5000000)
  ];
  const evidence = createCardanoPreprodRealUtxoBindingEvidence({
    plan,
    tipBefore: tip,
    tipAfter: tip,
    queriedUtxo
  });
  assert.equal(evidence.realUtxoReferencesExist, true);
  assert.equal(evidence.exactRoleReferenceBinding, true);
  assert.equal(evidence.phaseOneState.realUtxoBindingComplete, true);
  assert.equal(evidence.phaseOneState.fullPhaseOneValidated, false);
  assert.equal(evidence.liveActions.walletSigningAuthorized, false);
  assert.equal(evidence.liveActions.transactionSubmissionAuthorized, false);
  assert.match(evidence.evidenceSha256, /^[0-9a-f]{64}$/);

  const verified = verifyCardanoPreprodRealUtxoBindingEvidence({
    evidence,
    plan,
    tipBefore: tip,
    tipAfter: tip,
    queriedUtxo
  });
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('Cardano real UTxO evidence fails closed on tip drift, missing roles and non-ADA collateral', () => {
  const plan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles: {
      seed: ref('aa', 0),
      fee: ref('bb', 1),
      collateral: ref('cc', 2)
    }
  });
  const tip = { hash: 'dd'.repeat(32), slot: 135700000 };
  const queriedUtxo = [
    walletUtxo(plan.roles.seed, 10000000),
    walletUtxo(plan.roles.fee, 3000000),
    walletUtxo(plan.roles.collateral, 5000000)
  ];

  assert.throws(
    () => createCardanoPreprodRealUtxoBindingEvidence({
      plan,
      tipBefore: tip,
      tipAfter: { ...tip, slot: tip.slot + 1 },
      queriedUtxo
    }),
    /stable/
  );

  assert.throws(
    () => createCardanoPreprodRealUtxoBindingEvidence({
      plan,
      tipBefore: tip,
      tipAfter: tip,
      queriedUtxo: queriedUtxo.slice(0, 2)
    }),
    /collateral/
  );

  const tokenCollateral = structuredClone(queriedUtxo);
  tokenCollateral[2].value['ee'.repeat(28)] = { '4f56': '1' };
  assert.throws(
    () => createCardanoPreprodRealUtxoBindingEvidence({
      plan,
      tipBefore: tip,
      tipAfter: tip,
      queriedUtxo: tokenCollateral
    }),
    /ADA-only/
  );
});

test('Cardano real state UTxO binding requires applied recovery address, beacon and inline datum', () => {
  const plan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'heartbeat',
    roles: {
      state: ref('ab', 0),
      fee: ref('bc', 1),
      collateral: ref('cd', 2)
    }
  });
  const tip = { hash: 'de'.repeat(32), slot: 135700001 };
  const state = {
    ...plan.roles.state,
    address: CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress,
    value: {
      ada: { lovelace: '10000000' },
      [CARDANO_APPLIED_FIXTURE.beaconPolicyId]: {
        [CARDANO_APPLIED_FIXTURE.assetNameHex]: '1'
      }
    },
    datum: '80'
  };
  const queriedUtxo = [
    state,
    walletUtxo(plan.roles.fee, 3000000),
    walletUtxo(plan.roles.collateral, 5000000)
  ];

  const evidence = createCardanoPreprodRealUtxoBindingEvidence({
    plan,
    tipBefore: tip,
    tipAfter: tip,
    queriedUtxo
  });
  assert.equal(evidence.roles.state.datumPresent, true);

  const missingBeacon = structuredClone(queriedUtxo);
  delete missingBeacon[0].value[CARDANO_APPLIED_FIXTURE.beaconPolicyId];
  assert.throws(
    () => createCardanoPreprodRealUtxoBindingEvidence({
      plan,
      tipBefore: tip,
      tipAfter: tip,
      queriedUtxo: missingBeacon
    }),
    /state beacon/
  );
});
