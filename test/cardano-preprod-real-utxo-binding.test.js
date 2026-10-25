import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
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

const fixtureEvidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json', import.meta.url), 'utf8'));
const beaconBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vaultBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;
const sourceBlueprintSha256 = createHash('sha256')
  .update(readFileSync(new URL('../validators/cardano/plutus.json', import.meta.url)))
  .digest('hex');

function appliedIdentity() {
  return createCardanoPreprodAppliedValidatorIdentity({
    seedReference: {
      transaction: { id: fixtureEvidence.parameters.seedTxId },
      index: fixtureEvidence.parameters.seedOutputIndex
    },
    assetNameHex: fixtureEvidence.parameters.assetNameHex,
    sourceBlueprintSha256,
    beaconCompiledCode,
    recoveryCompiledCode,
    aikenPolicyId: fixtureEvidence.stateBeacon.policyId,
    aikenRecoveryHash: fixtureEvidence.recoveryVault.scriptHash,
    aikenRecoveryAddress: fixtureEvidence.recoveryVault.preprodAddress
  });
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
    seed: {
      transaction: { id: fixtureEvidence.parameters.seedTxId },
      index: fixtureEvidence.parameters.seedOutputIndex
    },
    collateral: ref('cc', 2)
  };
  return createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles,
    appliedValidatorIdentity: appliedIdentity()
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
      appliedValidatorIdentity: appliedIdentity()
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
      appliedValidatorIdentity: appliedIdentity()
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

test('Cardano real UTxO plan rejects rehashed Ogmios request envelope substitution', () => {
  const valid = initializePlan();
  assert.equal(verifyCardanoPreprodRealUtxoBindingPlan(valid).valid, true);
  assert.equal(valid.query.jsonrpc, '2.0');
  assert.deepEqual(Object.keys(valid.query).sort(), ['jsonrpc', 'method', 'params']);

  // Recompute the self-digest so the rejection is specifically from the
  // query-envelope validation, not merely a stale checksum.
  const variants = [
    { ...valid.query, jsonrpc: '1.0' },
    { ...valid.query, jsonrpc: '2.1' },
    { ...valid.query, id: 1 },
    { ...valid.query, network: 'mainnet' },
    { method: valid.query.method, params: valid.query.params },
    { jsonrpc: '2.0', method: 'queryLedgerState/utxo', params: valid.query.params, auth: true }
  ];
  for (const query of variants) {
    const tampered = structuredClone(valid);
    tampered.query = query;
    const { planSha256: _old, ...unsigned } = tampered;
    tampered.planSha256 = hashCardanoEvidence(unsigned);
    const checked = verifyCardanoPreprodRealUtxoBindingPlan(tampered);
    assert.equal(checked.valid, false, JSON.stringify(query));
    assert.match(checked.errors.join('; '), /exact Ogmios JSON-RPC 2.0 query envelope/);
    assert.throws(() => createCardanoPreprodRealUtxoBindingEvidence({
      plan: tampered,
      tipBefore: { hash: 'dd'.repeat(32), slot: 135700000 },
      tipAfter: { hash: 'dd'.repeat(32), slot: 135700000 },
      queriedUtxo: []
    }), /plan verification failed/);
  }
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
      queriedUtxo: queriedUtxo.slice(0, 1)
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
  const identity = appliedIdentity();
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

test('Cardano real UTxO binding rejects coercive output indices at plan and evidence boundaries', () => {
  const identity = appliedIdentity();
  const seed = {
    transaction: { id: fixtureEvidence.parameters.seedTxId },
    index: fixtureEvidence.parameters.seedOutputIndex
  };
  const invalid = [null, true, false, '', ' ', '0x10', '1e2', '-1', '01', '1.0', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, []];
  for (const index of invalid) {
    assert.throws(() => createCardanoPreprodRealUtxoBindingPlan({
      action: 'initialize',
      roles: { seed, collateral: ref('cc', index) },
      appliedValidatorIdentity: identity
    }), /non-negative safe integer/, String(index));
  }

  const plan = initializePlan();
  for (const index of invalid) {
    const tampered = structuredClone(plan);
    tampered.roles.collateral.index = index;
    assert.equal(verifyCardanoPreprodRealUtxoBindingPlan(tampered).valid, false, String(index));
  }

  const canonical = createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles: { seed, collateral: ref('cc', '2') },
    appliedValidatorIdentity: identity
  });
  assert.equal(canonical.roles.collateral.index, 2);
  assert.equal(verifyCardanoPreprodRealUtxoBindingPlan(canonical).valid, true);

  const tip = { hash: 'dd'.repeat(32), slot: 135700000 };
  const utxos = [walletUtxo(plan.roles.seed, 10000000), walletUtxo(plan.roles.collateral, 5000000)];
  for (const index of invalid) {
    const altered = structuredClone(utxos);
    altered[1].index = index;
    assert.throws(() => createCardanoPreprodRealUtxoBindingEvidence({
      plan, tipBefore: tip, tipAfter: tip, queriedUtxo: altered
    }), /non-negative safe integer/, String(index));
  }
});


test('Cardano real UTxO stable-tip hashes reject coercible containers and noncanonical evidence', () => {
  const plan = initializePlan();
  const hash = 'dd'.repeat(32);
  const tip = { hash, slot: 135700000 };
  const queriedUtxo = [
    walletUtxo(plan.roles.seed, 10000000),
    walletUtxo(plan.roles.collateral, 5000000)
  ];
  let coercions = 0;
  const trap = { toString() { coercions++; return hash; } };
  const invalid = [
    [hash], { hash }, trap, new String(hash), true, false, null, undefined,
    0, '', `0x${hash}`, hash.slice(2)
  ];
  for (const badHash of invalid) {
    for (const side of ['tipBefore', 'tipAfter']) {
      const options = { plan, tipBefore: tip, tipAfter: tip, queriedUtxo };
      options[side] = { ...tip, hash: badHash };
      assert.throws(
        () => createCardanoPreprodRealUtxoBindingEvidence(options),
        /32-byte hex string/,
        `${side}: ${typeof badHash}`
      );
    }
  }
  assert.equal(coercions, 0, 'Untrusted hash coercion hooks must never execute');

  const uppercaseTip = { ...tip, hash: hash.toUpperCase() };
  const evidence = createCardanoPreprodRealUtxoBindingEvidence({
    plan, tipBefore: uppercaseTip, tipAfter: tip, queriedUtxo
  });
  assert.equal(evidence.stableTip.hash, hash);
  assert.equal(verifyCardanoPreprodRealUtxoBindingEvidence({
    evidence, plan, tipBefore: uppercaseTip, tipAfter: tip, queriedUtxo
  }).valid, true);
  const rejected = verifyCardanoPreprodRealUtxoBindingEvidence({
    evidence, plan, tipBefore: { ...tip, hash: [hash] }, tipAfter: tip, queriedUtxo
  });
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join('; '), /32-byte hex string/);
});
