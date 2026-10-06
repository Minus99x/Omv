import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import {
  CARDANO_APPLIED_FIXTURE,
  CARDANO_PREPROD_NETWORK_ID
} from '../src/chains/cardano/transaction-body.js';
import {
  createCardanoPreprodRealUtxoBindingEvidence,
  createCardanoPreprodRealUtxoBindingPlan,
  verifyCardanoPreprodRealUtxoBindingEvidence,
  verifyCardanoPreprodRealUtxoBindingPlan
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

function appliedIdentity(seedReference) {
  const core = {
    schema: 'omegavault.cardano.preprod-applied-validator-identity.v1',
    network: 'preprod',
    networkId: CARDANO_PREPROD_NETWORK_ID,
    seedReference,
    assetNameHex: CARDANO_APPLIED_FIXTURE.assetNameHex,
    stateBeacon: { policyId: CARDANO_APPLIED_FIXTURE.beaconPolicyId },
    recoveryVault: {
      scriptHash: CARDANO_APPLIED_FIXTURE.recoveryValidatorHash,
      address: CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress
    }
  };
  return { ...core, identitySha256: hashCardanoEvidence(core) };
}

function walletUtxo(reference, lovelace, address = ownerAddress) {
  return {
    ...reference,
    address,
    value: { ada: { lovelace: String(lovelace) } }
  };
}

function initializePlan() {
  const roles = {
    seed: ref('aa', 0),
    collateral: ref('cc', 2)
  };
  return createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles,
    appliedValidatorIdentity: appliedIdentity(roles.seed)
  });
}

test('Cardano real initialize UTxO plan binds distinct seed/collateral references to one validator identity', () => {
  const plan = initializePlan();
  assert.equal(plan.network, 'preprod');
  assert.equal(plan.networkId, 0);
  assert.deepEqual(Object.keys(plan.roles), ['seed', 'collateral']);
  assert.equal(plan.query.method, 'queryLedgerState/utxo');
  assert.equal(plan.query.params.outputReferences.length, 2);
  assert.equal(plan.validatorIdentity.seedReference.transaction.id, plan.roles.seed.transaction.id);
  assert.equal(plan.walletSigningAuthorized, false);
  assert.equal(plan.transactionSubmissionAuthorized, false);
  assert.match(plan.planSha256, /^[0-9a-f]{64}$/);

  assert.throws(
    () => createCardanoPreprodRealUtxoBindingPlan({
      action: 'initialize',
      roles: {
        seed: ref('aa', 0),
        collateral: ref('aa', 0)
      },
      appliedValidatorIdentity: appliedIdentity(ref('aa', 0))
    }),
    /distinct/
  );

  assert.throws(
    () => createCardanoPreprodRealUtxoBindingPlan({
      action: 'initialize',
      roles: {
        seed: ref('aa', 0),
        collateral: ref('cc', 2)
      },
      appliedValidatorIdentity: appliedIdentity(ref('ff', 0))
    }),
    /exactly match/
  );
});

test('Cardano real UTxO plan verifier rejects query or authority tampering', () => {
  const plan = initializePlan();
  assert.equal(verifyCardanoPreprodRealUtxoBindingPlan(plan).valid, true);

  const queryTampered = structuredClone(plan);
  queryTampered.query.params.outputReferences[0].index = 99;
  assert.equal(verifyCardanoPreprodRealUtxoBindingPlan(queryTampered).valid, false);

  const authorityTampered = structuredClone(plan);
  authorityTampered.walletSigningAuthorized = true;
  assert.equal(verifyCardanoPreprodRealUtxoBindingPlan(authorityTampered).valid, false);
});

test('Cardano real initialize UTxO evidence accepts exact stable-tip ADA-only seed/collateral set', () => {
  const plan = initializePlan();
  const tip = { hash: 'dd'.repeat(32), slot: 135700000 };
  const queriedUtxo = [
    walletUtxo(plan.roles.seed, 10000000),
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
  assert.equal(evidence.walletPaymentKeyHash, '11'.repeat(28));
  assert.equal(evidence.validatorIdentitySha256, plan.validatorIdentity.identitySha256);
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

test('Cardano real UTxO evidence fails closed on tip drift, missing roles, non-ADA collateral and mixed wallets', () => {
  const plan = initializePlan();
  const tip = { hash: 'dd'.repeat(32), slot: 135700000 };
  const queriedUtxo = [
    walletUtxo(plan.roles.seed, 10000000),
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
  tokenCollateral[1].value['ee'.repeat(28)] = { '4f56': '1' };
  assert.throws(
    () => createCardanoPreprodRealUtxoBindingEvidence({
      plan,
      tipBefore: tip,
      tipAfter: tip,
      queriedUtxo: tokenCollateral
    }),
    /ADA-only/
  );

  const mixedWallets = structuredClone(queriedUtxo);
  mixedWallets[1].address = walletAddress('22');
  assert.throws(
    () => createCardanoPreprodRealUtxoBindingEvidence({
      plan,
      tipBefore: tip,
      tipAfter: tip,
      queriedUtxo: mixedWallets
    }),
    /same payment verification key/
  );
});

test('Cardano real state UTxO binding uses the bound dynamic recovery address, beacon and inline datum', () => {
  const identity = appliedIdentity(ref('aa', 0));
  const plan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'heartbeat',
    roles: {
      state: ref('ab', 0),
      fee: ref('bc', 1),
      collateral: ref('cd', 2)
    },
    appliedValidatorIdentity: identity
  });
  const tip = { hash: 'de'.repeat(32), slot: 135700001 };
  const state = {
    ...plan.roles.state,
    address: plan.validatorIdentity.recoveryValidatorAddress,
    value: {
      ada: { lovelace: '10000000' },
      [plan.validatorIdentity.stateBeaconPolicyId]: {
        [plan.validatorIdentity.assetNameHex]: '1'
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
  delete missingBeacon[0].value[plan.validatorIdentity.stateBeaconPolicyId];
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
