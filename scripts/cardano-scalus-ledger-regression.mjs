/** Optional REAL Scalus validation, not a stub. Run only after installing scalus@1.3.0. */
import test from 'node:test';
import { createHash } from 'node:crypto';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import { runCardanoScalusInitializeTrial } from '../src/chains/cardano/scalus-local-validation.js';

import { readFileSync } from 'node:fs';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
import {
  createCardanoPreprodRealUtxoBindingEvidence,
  createCardanoPreprodRealUtxoBindingPlan
} from '../src/chains/cardano/preprod-real-utxo-binding.js';
import { buildCardanoPreprodRealInitializeCandidate } from '../src/chains/cardano/preprod-real-initialize.js';
import { buildCardanoPreprodRealHeartbeatCandidate } from '../src/chains/cardano/preprod-real-heartbeat.js';
import { buildCardanoPreprodRealApprovalCandidate } from '../src/chains/cardano/preprod-real-approval.js';
import { createCardanoVaultDatumData } from '../src/chains/cardano/transaction-body.js';


import assert from 'node:assert/strict';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { CardanoInfo, Emulator, Utxo, Value } from 'scalus';

const TEST_TXID = 'ab'.repeat(32);
const SLOT = 135700000;
const COIN = 1_000_000_000n;
const privateKey = CSL.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 9));
const contactAKey = CSL.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 10));
const contactBKey = CSL.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 11));
const approvalContacts = [contactAKey.to_public().hash().to_hex(), contactBKey.to_public().hash().to_hex()];
const contactAddress = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(contactAKey.to_public().hash())).to_address().to_bech32();
const CONTACT_FUNDING_TXID = '45'.repeat(32);
const CONTACT_COLLATERAL_TXID = '46'.repeat(32);
const ownerAddress = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(privateKey.to_public().hash())).to_address();
const address = ownerAddress.to_bech32();

function localEmulator(slot = SLOT) {
  // Separate, disposable ledger for each test: no provider and no public network.
  return Emulator.create(CardanoInfo.preprod(), {
    slot,
    utxos: [new Utxo(TEST_TXID, 0, address, new Value(COIN))]
  });
}

function signedPayment({ fee = 200_000n, ttl = SLOT + 100, signed = true } = {}) {
  const ins = CSL.TransactionInputs.new();
  ins.add(CSL.TransactionInput.new(CSL.TransactionHash.from_hex(TEST_TXID), 0));
  const outs = CSL.TransactionOutputs.new();
  outs.add(CSL.TransactionOutput.new(ownerAddress, CSL.Value.new(CSL.BigNum.from_str((COIN - fee).toString()))));
  const body = CSL.TransactionBody.new(ins, outs, CSL.BigNum.from_str(fee.toString()), ttl);
  body.set_validity_start_interval(SLOT - 10);
  const witnessSet = CSL.TransactionWitnessSet.new();
  if (signed) {
    const witnesses = CSL.Vkeywitnesses.new();
    const bodyHash = CSL.TransactionHash.from_bytes(blake2b(body.to_bytes(), { dkLen: 32 }));
    witnesses.add(CSL.make_vkey_witness(bodyHash, privateKey));
    witnessSet.set_vkeys(witnesses);
  }
  return CSL.Transaction.new(body, witnessSet, undefined).to_bytes();
}

test('Scalus Preprod emulator accepts a properly signed CSL test-only spend, then rejects replay', () => {
  const emulator = localEmulator();
  const bytes = signedPayment();
  const accepted = emulator.submitTx(bytes);
  assert.equal(accepted.isSuccess, true, `${accepted.errorRule ?? ''}: ${accepted.error ?? ''}`);
  assert.match(accepted.txHash, /^[0-9a-f]{64}$/i);
  const replay = emulator.submitTx(bytes);
  assert.equal(replay.isSuccess, false, 'same input was spent and must not be accepted twice');
});

test('Scalus Preprod emulator rejects a transaction without the required payment witness', () => {
  const emulator = localEmulator();
  const denied = emulator.submitTx(signedPayment({ signed: false }));
  assert.equal(denied.isSuccess, false);
});

test('Scalus Preprod emulator rejects an expired validity interval', () => {
  const emulator = localEmulator(SLOT + 101);
  const denied = emulator.submitTx(signedPayment());
  assert.equal(denied.isSuccess, false);
});

test('Scalus Preprod emulator enforces the minimum transaction fee', () => {
  const emulator = localEmulator();
  const denied = emulator.submitTx(signedPayment({ fee: 1n }));
  assert.equal(denied.isSuccess, false);
});


/**
 * Synthetic test-only evidence: verifies the full adapter -> genuine emulator
 * boundary with CSL-signed bytes. This is NOT a captured OmegaVault initialize,
 * independently verified wallet evidence, or a current Preprod UTxO snapshot.
 */
function syntheticAdapterEvidence(bytes) {
  const tip = { hash: 'cd'.repeat(32), slot: SLOT };
  const mk = (id, lovelace) => ({
    reference: { transaction: { id }, index: 0 },
    address,
    value: { ada: { lovelace: String(lovelace) } },
    datum: null, datumHash: null, script: null
  });
  const ledgerInputSnapshot = {
    source: 'read-only-ogmios-queryLedgerState/utxo',
    tip,
    utxos: {
      seed: mk(TEST_TXID, COIN),
      collateral: mk('fe'.repeat(32), 6_000_000n)
    }
  };
  const evidence = {
    schema: 'omegavault.cardano.preprod-initialize-pre-submit-evidence.v2',
    network: 'preprod',
    action: 'initialize',
    checks: {
      preSubmitFreshnessGateComplete: true,
      walletWitnessEvidenceVerified: true,
      completePhaseOneValidated: false
    },
    liveActions: {
      transactionSubmissionAuthorized: false,
      transactionSubmissionPerformed: false
    },
    signedTransaction: {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length
    },
    validity: { lowerSlot: SLOT - 10, upperSlot: SLOT + 100 },
    currentTip: tip,
    ledgerInputSnapshot,
    ledgerInputSnapshotSha256: hashCardanoEvidence(ledgerInputSnapshot)
  };
  evidence.preSubmitSha256 = hashCardanoEvidence(evidence);
  return evidence;
}

test('real Scalus adapter accepts test-only signed CBOR with digest-bound inputs, without public authority', async () => {
  const bytes = signedPayment();
  const output = await runCardanoScalusInitializeTrial({
    signedTransactionCborHex: Buffer.from(bytes).toString('hex'),
    preSubmitEvidence: syntheticAdapterEvidence(bytes),
    simulatedSlot: SLOT
  });
  assert.equal(output.acceptedByEmulator, true, output.rejection ?? 'unexpected rejection');
  assert.match(output.localTransactionHash, /^[0-9a-f]{64}$/);
  assert.equal(output.source, 'scalus-emulator');
  assert.equal(output.authority.completeCurrentPreprodPhaseOneValidated, false);
  assert.equal(output.authority.publicPreprodTransactionSubmitted, false);
  assert.equal(output.authority.supportClaimAuthorized, false);
});

test('real Scalus adapter rejects test-only expired and unsigned CBOR without inventing public proof', async () => {
  for (const [bytes, simulatedSlot] of [
    [signedPayment(), SLOT + 101],
    [signedPayment({ signed: false }), SLOT]
  ]) {
    const outcome = await runCardanoScalusInitializeTrial({
      signedTransactionCborHex: Buffer.from(bytes).toString('hex'),
      preSubmitEvidence: syntheticAdapterEvidence(bytes),
      simulatedSlot
    });
    assert.equal(outcome.acceptedByEmulator, false);
    assert.equal(outcome.localTransactionHash, null);
    assert.equal(outcome.authority.publicNetworkRecoveryProven, false);
  }
});

test('real Scalus adapter fails closed before emulation for signed CBOR evidence drift', async () => {
  const bytes = signedPayment();
  const altered = Buffer.from(bytes);
  altered[altered.length - 1] ^= 1;
  await assert.rejects(
    runCardanoScalusInitializeTrial({
      signedTransactionCborHex: altered.toString('hex'),
      preSubmitEvidence: syntheticAdapterEvidence(bytes)
    }),
    /signed transaction bytes differ/
  );
});


/**
 * Reconstructs OmegaVault's actual Plutus V3 beacon-mint initialize CBOR from
 * checked-in public fixtures. Signs with a deterministic CI-only key and seeds
 * a fresh simulated ledger. This does not use the Captain's wallet, live UTxOs,
 * current protocol parameters, or a public Preprod node.
 */
function locallySignedOmegaVaultInitialize({ contacts = ['22'.repeat(28), '33'.repeat(28)] } = {}) {
  const load = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
  const fixture = load('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json');
  const beacon = load('../validators/cardano/fixtures/state-beacon.applied.json');
  const vault = load('../validators/cardano/fixtures/recovery-vault.applied.json');
  const snapshot = load('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json');
  snapshot.source.independentSourceCount = 2;
  snapshot.promotion.independentlyConfirmed = true;
  const parameters = normalizeCardanoProtocolParameterSnapshot(snapshot);
  const appliedValidatorIdentity = createCardanoPreprodAppliedValidatorIdentity({
    seedReference: {
      transaction: { id: fixture.parameters.seedTxId },
      index: fixture.parameters.seedOutputIndex
    },
    assetNameHex: fixture.parameters.assetNameHex,
    sourceBlueprintSha256: createHash('sha256')
      .update(readFileSync(new URL('../validators/cardano/plutus.json', import.meta.url)))
      .digest('hex'),
    beaconCompiledCode: beacon.validators.find(v => v.title === 'omegavault.state_beacon.mint').compiledCode,
    recoveryCompiledCode: vault.validators.find(v => v.title === 'omegavault.recovery_vault.spend').compiledCode,
    aikenPolicyId: fixture.stateBeacon.policyId,
    aikenRecoveryHash: fixture.recoveryVault.scriptHash,
    aikenRecoveryAddress: fixture.recoveryVault.preprodAddress
  });
  const seedRef = appliedValidatorIdentity.seedReference;
  const collateralRef = { transaction: { id: '12'.repeat(32) }, index: 0 };
  const plan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles: { seed: seedRef, collateral: collateralRef },
    appliedValidatorIdentity
  });
  const tip = { hash: 'aa'.repeat(32), slot: SLOT };
  const utxoBindingEvidence = createCardanoPreprodRealUtxoBindingEvidence({
    plan,
    tipBefore: tip,
    tipAfter: tip,
    queriedUtxo: [
      { ...seedRef, address, value: { ada: { lovelace: '20000000' } } },
      { ...collateralRef, address, value: { ada: { lovelace: '5000000' } } }
    ]
  });
  const candidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig: {
      rescueKeyHash: '66'.repeat(28),
      contactKeyHashes: contacts,
      threshold: 2,
      inactivityMs: 60000,
      stateLovelace: '10000000'
    },
    evaluationMode: false,
    mintBudget: { memory: '101167', steps: '30755345' }
  });
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized, false);
  const unsigned = CSL.Transaction.from_hex(candidate.transaction.cborHex);
  const witnesses = CSL.TransactionWitnessSet.from_bytes(unsigned.witness_set().to_bytes());
  const vkeys = CSL.Vkeywitnesses.new();
  const bodyHash = CSL.TransactionHash.from_bytes(blake2b(unsigned.body().to_bytes(), { dkLen: 32 }));
  vkeys.add(CSL.make_vkey_witness(bodyHash, privateKey));
  witnesses.set_vkeys(vkeys);
  const signed = CSL.Transaction.new(unsigned.body(), witnesses, undefined).to_bytes();
  return { candidate, signed, appliedValidatorIdentity, seedRef, collateralRef };
}

function omegaVaultInitializeLedger(a, slot = SLOT, extraUtxos = []) {
  return Emulator.create(CardanoInfo.preprod(), {
    slot,
    utxos: [
      // Scalus Value.ada(x) multiplies ADA by 1e6. UTxOs contain lovelace.
      new Utxo(a.seedRef.transaction.id, a.seedRef.index, address, new Value(20_000_000n)),
      new Utxo(a.collateralRef.transaction.id, a.collateralRef.index, address, new Value(5_000_000n)),
      ...extraUtxos
    ]
  });
}

test('genuine Scalus ledger validates an OmegaVault-built minting initialize candidate (fixture only)', () => {
  const artifact = locallySignedOmegaVaultInitialize();
  const emulator = omegaVaultInitializeLedger(artifact);
  const result = emulator.submitTx(artifact.signed);
  assert.equal(result.isSuccess, true,
    `OmegaVault initialize rejected by ${result.errorRule ?? 'unknown'}: ${result.error ?? 'unknown'} ${(result.logs ?? []).join('; ')}`);
  assert.match(result.txHash, /^[0-9a-f]{64}$/i);
  assert.equal(emulator.getUtxos({ address: artifact.appliedValidatorIdentity.recoveryVault.address }).length, 1);
  assert.equal(emulator.submitTx(artifact.signed).isSuccess, false, 'initialize input must not be replayable');
  assert.equal(artifact.candidate.liveActions.transactionSubmissionAuthorized, false);
});


test('Scalus rejects OmegaVault initialize without owner signing or after its validity deadline', () => {
  const artifact = locallySignedOmegaVaultInitialize();
  const unsignedBytes = Buffer.from(artifact.candidate.transaction.cborHex, 'hex');
  const witnessDenied = omegaVaultInitializeLedger(artifact).submitTx(unsignedBytes);
  assert.equal(witnessDenied.isSuccess, false, 'owner signature is required for beacon mint');
  const expired = omegaVaultInitializeLedger(artifact, artifact.candidate.validity.upperSlot + 1)
    .submitTx(artifact.signed);
  assert.equal(expired.isSuccess, false, 'the OmegaVault initialize validity deadline must be enforced');
});

test('Scalus rejects OmegaVault initialize signed by an unauthorized test key', () => {
  const artifact = locallySignedOmegaVaultInitialize();
  const unsigned = CSL.Transaction.from_hex(artifact.candidate.transaction.cborHex);
  const witnessSet = CSL.TransactionWitnessSet.from_bytes(unsigned.witness_set().to_bytes());
  const wrongKey = CSL.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 10));
  const vkeys = CSL.Vkeywitnesses.new();
  const bodyHash = CSL.TransactionHash.from_bytes(blake2b(unsigned.body().to_bytes(), { dkLen: 32 }));
  vkeys.add(CSL.make_vkey_witness(bodyHash, wrongKey));
  witnessSet.set_vkeys(vkeys);
  const forged = CSL.Transaction.new(unsigned.body(), witnessSet, undefined).to_bytes();
  const rejected = omegaVaultInitializeLedger(artifact).submitTx(forged);
  assert.equal(rejected.isSuccess, false, 'only the bound owner payment key can authorize initialize');
});


/**
 * Local-only sequential lifecycle test. Uses the exact Scalus ledger output
 * created by OmegaVault's initialize transaction as the heartbeat input.
 * Does NOT claim public Preprod inclusion/finality, approval or submission
 * authority. The plan's observation identifiers are local synthetic fixtures.
 */
function initializeThenBuildHeartbeat({ contacts = ['22'.repeat(28), '33'.repeat(28)], extraUtxos = [] } = {}) {
  const setup = locallySignedOmegaVaultInitialize({ contacts });
  const emulator = omegaVaultInitializeLedger(setup, SLOT, extraUtxos);
  const initResult = emulator.submitTx(setup.signed);
  assert.equal(initResult.isSuccess, true, `initialize rejected: ${initResult.errorRule} ${initResult.error}`);
  const state = emulator.getUtxos({ outRefs: [{ txHash: initResult.txHash, outputIndex: 0 }] });
  const funding = emulator.getUtxos({ outRefs: [{ txHash: initResult.txHash, outputIndex: 1 }] });
  assert.equal(state.length, 1, 'real emulator must hold initialized state');
  assert.equal(funding.length, 1, 'real emulator must hold owner change');
  assert.equal(state[0].address, setup.appliedValidatorIdentity.recoveryVault.address);
  const initTx = CSL.Transaction.from_hex(setup.candidate.transaction.cborHex);
  const predecessorDatum = initTx.body().outputs().get(0).plutus_data().to_hex();
  assert.equal(Buffer.from(state[0].inlineDatum).toString('hex'), predecessorDatum);
  const identity = setup.appliedValidatorIdentity;
  const ownerHash = privateKey.to_public().hash().to_hex();
  const planCore = {
    schema: 'omegavault.cardano.preprod-real-heartbeat-plan.v1',
    network: 'preprod', action: 'heartbeat',
    predecessorStateObservationSha256: 'fa'.repeat(32), // synthetic local observation, NOT real public inclusion
    predecessorTransactionBodyHash: initResult.txHash,
    predecessorObservedTip: { hash: 'be'.repeat(32), slot: SLOT },
    validatorIdentitySha256: identity.identitySha256,
    stateInput: { transaction: { id: initResult.txHash }, index: 0 },
    ownerFundingInput: { transaction: { id: initResult.txHash }, index: 1 },
    ownerFundingAddress: address,
    collateralInput: setup.collateralRef,
    collateralAddress: address,
    ownerPaymentKeyHash: ownerHash,
    protectedState: {
      address: identity.recoveryVault.address,
      lovelace: state[0].value.coin.toString(),
      beaconPolicyId: identity.stateBeacon.policyId,
      beaconAssetNameHex: identity.assetNameHex,
      beaconQuantity: '1',
      predecessorInlineDatumCborHex: predecessorDatum,
      predecessorLastHeartbeatMs: setup.candidate.validity.initialHeartbeatMs,
      predecessorApprovalKeyHashes: []
    },
    externalFunding: {
      fundingLovelace: funding[0].value.coin.toString(),
      collateralLovelace: '5000000',
      feeMustComeFromExternalFunding: true,
      protectedStateMayNotPayFees: true
    },
    liveActions: {
      walletSigningAuthorized: false,
      transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false
    }
  };
  const heartbeatPlan = { ...planCore, planSha256: hashCardanoEvidence(planCore) };
  const protocol = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
  protocol.source.independentSourceCount = 2;
  protocol.promotion.independentlyConfirmed = true;
  const parameters = normalizeCardanoProtocolParameterSnapshot(protocol);
  const stableTip = { hash: 'ba'.repeat(32), slot: SLOT + 70 };
  emulator.setSlot(stableTip.slot);
  const args = {
    heartbeatPlan,
    appliedValidatorIdentity: identity,
    parameters,
    recoveryConfig: {
      rescueKeyHash: '66'.repeat(28),
      contactKeyHashes: contacts,
      threshold: 2,
      inactivityMs: 60000,
      stateLovelace: '10000000'
    },
    stableTip
  };
  const evaluationCandidate = buildCardanoPreprodRealHeartbeatCandidate({
    ...args, evaluationMode: true
  });
  const evaluation = emulator.evaluateTx(Buffer.from(evaluationCandidate.transaction.cborHex, 'hex'));
  assert.equal(evaluation.length, 1, 'heartbeat must evaluate exactly one spend redeemer');
  assert.equal(evaluation[0].tag, 'Spend');
  const measured = evaluation[0].budget;
  const spendBudget = {
    memory: (BigInt(measured.memory) * 115n / 100n + 1n).toString(),
    steps: (BigInt(measured.steps) * 115n / 100n + 1n).toString()
  };
  const candidate = buildCardanoPreprodRealHeartbeatCandidate({
    ...args, evaluationMode: false, spendBudget
  });
  assert.equal(candidate.checks.protectedLovelacePreserved, true);
  assert.equal(candidate.checks.feePaidOnlyFromExternalOwnerFunding, true);
  const unsigned = CSL.Transaction.from_hex(candidate.transaction.cborHex);
  const witnesses = CSL.TransactionWitnessSet.from_bytes(unsigned.witness_set().to_bytes());
  const vkeys = CSL.Vkeywitnesses.new();
  const bodyHash = CSL.TransactionHash.from_bytes(blake2b(unsigned.body().to_bytes(), { dkLen: 32 }));
  vkeys.add(CSL.make_vkey_witness(bodyHash, privateKey));
  witnesses.set_vkeys(vkeys);
  const signed = CSL.Transaction.new(unsigned.body(), witnesses, undefined).to_bytes();
  return { setup, emulator, candidate, signed, initResult, predecessorDatum };
}

test('real Scalus executes initialize then heartbeat with OmegaVault-built transactions (fixture only)', () => {
  const { emulator, candidate, signed, initResult, predecessorDatum, setup } = initializeThenBuildHeartbeat();
  const accepted = emulator.submitTx(signed);
  assert.equal(accepted.isSuccess, true,
    `heartbeat rejected by ${accepted.errorRule}: ${accepted.error} ${(accepted.logs ?? []).join('; ')}`);
  assert.match(accepted.txHash, /^[0-9a-f]{64}$/i);
  const oldState = emulator.getUtxos({ outRefs: [{ txHash: initResult.txHash, outputIndex: 0 }] });
  assert.equal(oldState.length, 0, 'heartbeat must consume the previous state');
  const newState = emulator.getUtxos({ outRefs: [{ txHash: accepted.txHash, outputIndex: 0 }] });
  assert.equal(newState.length, 1, 'heartbeat must emit one continuing state');
  assert.equal(newState[0].address, setup.appliedValidatorIdentity.recoveryVault.address);
  assert.equal(newState[0].value.coin, 10_000_000n, 'protected value must not pay fees');
  assert.equal(newState[0].value.assets.length, 1, 'exactly one state beacon must survive');
  assert.notEqual(Buffer.from(newState[0].inlineDatum).toString('hex'), predecessorDatum, 'heartbeat timestamp must advance');
  const ownerHash = privateKey.to_public().hash().to_hex();
  const expectedDatum = createCardanoVaultDatumData({
    ownerKeyHash: ownerHash, rescueKeyHash: '66'.repeat(28),
    contactKeyHashes: ['22'.repeat(28), '33'.repeat(28)],
    threshold: 2, inactivityMs: 60000,
    lastHeartbeatMs: candidate.validity.nextHeartbeatMs, approvalKeyHashes: []
  });
  assert.equal(Buffer.from(newState[0].inlineDatum).toString('hex'),
    expectedDatum.to_hex(), 'continuing state must preserve rescue/contacts/threshold and clear approvals');
  assert.equal(emulator.submitTx(signed).isSuccess, false, 'spent state cannot be replayed');
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized, false);
  assert.equal(candidate.checks.fullPhaseOneValidated, false);
});


test('real Scalus heartbeat rejects missing, unauthorized, and expired owner witnesses (fixture only)', () => {
  for (const variant of ['unsigned', 'wrong-key', 'expired']) {
    const { emulator, signed, candidate, initResult } = initializeThenBuildHeartbeat();
    let attempted;
    if (variant === 'unsigned') {
      attempted = Buffer.from(candidate.transaction.cborHex, 'hex');
    } else if (variant === 'wrong-key') {
      const tx = CSL.Transaction.from_bytes(signed);
      const witnesses = CSL.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
      const bad = CSL.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 10));
      const vkeys = CSL.Vkeywitnesses.new();
      const bodyHash = CSL.TransactionHash.from_bytes(blake2b(tx.body().to_bytes(), { dkLen: 32 }));
      vkeys.add(CSL.make_vkey_witness(bodyHash, bad));
      witnesses.set_vkeys(vkeys);
      attempted = CSL.Transaction.new(tx.body(), witnesses, undefined).to_bytes();
    } else {
      emulator.setSlot(candidate.validity.upperSlot + 1);
      attempted = signed;
    }
    const outcome = emulator.submitTx(attempted);
    assert.equal(outcome.isSuccess, false, `heartbeat must reject ${variant}`);
    assert.equal(emulator.getUtxos({
      outRefs: [{ txHash: initResult.txHash, outputIndex: 0 }]
    }).length, 1, 'invalid heartbeat must not consume protected state');
  }
});
