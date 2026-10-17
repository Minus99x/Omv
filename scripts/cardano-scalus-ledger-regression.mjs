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
import { createCardanoPreprodRealExecutePlan } from '../src/chains/cardano/preprod-real-execute-plan.js';
import { buildCardanoPreprodRealExecuteCandidate } from '../src/chains/cardano/preprod-real-execute.js';
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
const CONTACT_B_FUNDING_TXID = '47'.repeat(32);
const CONTACT_B_COLLATERAL_TXID = '48'.repeat(32);
const contactBAddress = CSL.EnterpriseAddress.new(0,
  CSL.Credential.from_keyhash(contactBKey.to_public().hash())).to_address().to_bech32();
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


// Test-only sequential approval. All observations and signing keys below are
// ephemeral fixture values; none certifies real public Preprod inclusion.
function localHeartbeatThenApproval() {
  const extraUtxos = [
    new Utxo(CONTACT_FUNDING_TXID, 0, contactAddress, new Value(8_000_000n)),
    new Utxo(CONTACT_COLLATERAL_TXID, 0, contactAddress, new Value(5_000_000n)),
    new Utxo(CONTACT_B_FUNDING_TXID, 0, contactBAddress, new Value(8_000_000n)),
    new Utxo(CONTACT_B_COLLATERAL_TXID, 0, contactBAddress, new Value(5_000_000n))
  ];
  const phase = initializeThenBuildHeartbeat({ contacts: approvalContacts, extraUtxos });
  const acceptedHeartbeat = phase.emulator.submitTx(phase.signed);
  assert.equal(acceptedHeartbeat.isSuccess, true,
    'heartbeat: ' + acceptedHeartbeat.errorRule + ' ' + acceptedHeartbeat.error);
  const ref = { txHash: acceptedHeartbeat.txHash, outputIndex: 0 };
  const observed = phase.emulator.getUtxos({ outRefs: [ref] });
  assert.equal(observed.length, 1, 'approval input must originate from emulated heartbeat');
  const datumHex = Buffer.from(observed[0].inlineDatum).toString('hex');
  const identity = phase.setup.appliedValidatorIdentity;
  const ownerHash = privateKey.to_public().hash().to_hex();
  const expectedDatum = createCardanoVaultDatumData({
    ownerKeyHash: ownerHash, rescueKeyHash: '66'.repeat(28),
    contactKeyHashes: approvalContacts, threshold: 2, inactivityMs: 60000,
    lastHeartbeatMs: phase.candidate.validity.nextHeartbeatMs, approvalKeyHashes: []
  }).to_hex();
  assert.equal(datumHex, expectedDatum);
  const selected = approvalContacts[0];
  const planCore = {
    schema: 'omegavault.cardano.preprod-real-approval-plan.v1',
    network: 'preprod', action: 'approve',
    predecessorStateEvidenceSha256: 'ba'.repeat(32), // SYNTHETIC, never public evidence
    predecessorTransactionBodyHash: acceptedHeartbeat.txHash,
    predecessorObservedTip: { hash: 'bc'.repeat(32), slot: SLOT + 70 },
    validatorIdentitySha256: identity.identitySha256,
    stateInput: { transaction: { id: acceptedHeartbeat.txHash }, index: 0 },
    selectedContactKeyHash: selected,
    contactFundingInput: { transaction: { id: CONTACT_FUNDING_TXID }, index: 0 },
    contactFundingAddress: contactAddress,
    contactCollateralInput: { transaction: { id: CONTACT_COLLATERAL_TXID }, index: 0 },
    contactCollateralAddress: contactAddress,
    protectedState: {
      address: identity.recoveryVault.address, lovelace: '10000000',
      beaconPolicyId: identity.stateBeacon.policyId,
      beaconAssetNameHex: identity.assetNameHex, beaconQuantity: '1',
      predecessorInlineDatumCborHex: datumHex,
      ownerPaymentKeyHash: ownerHash, rescueKeyHash: '66'.repeat(28),
      contactKeyHashes: approvalContacts, threshold: 2, inactivityMs: 60000,
      lastHeartbeatMs: phase.candidate.validity.nextHeartbeatMs,
      predecessorApprovalKeyHashes: [], nextApprovalKeyHashes: [selected]
    },
    externalFunding: {
      fundingLovelace: '8000000', collateralLovelace: '5000000',
      feeMustComeFromSelectedContactFunding: true, protectedStateMayNotPayFees: true
    },
    authorityChecks: {
      selectedSignerIsConfiguredContact: true, selectedSignerIsNotOwner: true,
      selectedSignerIsNotRescue: true, duplicateApprovalRejected: true,
      selectedContactControlsFunding: true, selectedContactControlsCollateral: true,
      independentContactWalletRequiredForPublicMultipartyProof: true
    },
    liveActions: {
      walletSigningAuthorized: false, transactionSubmissionAuthorized: false,
      supportClaimAuthorized: false
    }
  };
  const approvalPlan = { ...planCore, planSha256: hashCardanoEvidence(planCore) };
  const raw = JSON.parse(readFileSync(
    new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
  raw.source.independentSourceCount = 2;
  raw.promotion.independentlyConfirmed = true;
  const params = normalizeCardanoProtocolParameterSnapshot(raw);
  const stableTip = { hash: 'bd'.repeat(32), slot: SLOT + 240 };
  phase.emulator.setSlot(stableTip.slot);
  const args = {
    approvalPlan, appliedValidatorIdentity: identity, parameters: params, stableTip,
    recoveryConfig: {
      ownerPaymentKeyHash: ownerHash, rescueKeyHash: '66'.repeat(28),
      contactKeyHashes: approvalContacts, threshold: 2, inactivityMs: 60000,
      stateLovelace: '10000000'
    }
  };
  const evaluationCandidate = buildCardanoPreprodRealApprovalCandidate({
    ...args, evaluationMode: true
  });
  assert.equal(evaluationCandidate.liveActions.transactionSubmissionAuthorized, false);
  const evaluation = phase.emulator.evaluateTx(Buffer.from(evaluationCandidate.transaction.cborHex, 'hex'));
  assert.equal(evaluation.length, 1, 'exactly one actual approval spend script');
  assert.equal(evaluation[0].tag, 'Spend');
  const budget = {
    memory: (BigInt(evaluation[0].budget.memory) * 115n / 100n + 1n).toString(),
    steps: (BigInt(evaluation[0].budget.steps) * 115n / 100n + 1n).toString()
  };
  const candidate = buildCardanoPreprodRealApprovalCandidate({
    ...args, evaluationMode: false, spendBudget: budget
  });
  assert.deepEqual(candidate.stateTransition.nextApprovals, [selected]);
  assert.equal(candidate.stateTransition.protectedValueUsedForFees, false);
  const unsigned = CSL.Transaction.from_hex(candidate.transaction.cborHex);
  const witnesses = CSL.TransactionWitnessSet.from_bytes(unsigned.witness_set().to_bytes());
  const vkeys = CSL.Vkeywitnesses.new();
  const bodyHash = CSL.TransactionHash.from_bytes(blake2b(unsigned.body().to_bytes(), { dkLen: 32 }));
  vkeys.add(CSL.make_vkey_witness(bodyHash, contactAKey));
  witnesses.set_vkeys(vkeys);
  const signed = CSL.Transaction.new(unsigned.body(), witnesses, undefined).to_bytes();
  return { ...phase, ref, selected, candidate, signed, datumHex,
    heartbeat: acceptedHeartbeat, approvalPlan, params, recoveryConfig: args.recoveryConfig };
}

test('real Scalus executes initialize, heartbeat, then contact approval (fixture only)', () => {
  const { emulator, ref, candidate, signed, datumHex, selected, setup } = localHeartbeatThenApproval();
  const result = emulator.submitTx(signed);
  assert.equal(result.isSuccess, true, 'approval: ' + result.errorRule + ' ' + result.error);
  assert.equal(emulator.getUtxos({ outRefs: [ref] }).length, 0, 'old state spent');
  const next = emulator.getUtxos({ outRefs: [{ txHash: result.txHash, outputIndex: 0 }] });
  assert.equal(next.length, 1, 'one continuing approval state');
  assert.equal(next[0].address, setup.appliedValidatorIdentity.recoveryVault.address);
  assert.equal(next[0].value.coin, 10_000_000n, 'state value protected');
  assert.equal(next[0].value.assets.length, 1, 'single beacon preserved');
  assert.notEqual(Buffer.from(next[0].inlineDatum).toString('hex'), datumHex);
  const expected = createCardanoVaultDatumData({
    ownerKeyHash: privateKey.to_public().hash().to_hex(),
    rescueKeyHash: '66'.repeat(28), contactKeyHashes: approvalContacts,
    threshold: 2, inactivityMs: 60000,
    lastHeartbeatMs: candidate.stateTransition.lastHeartbeatMs,
    approvalKeyHashes: [selected]
  }).to_hex();
  assert.equal(Buffer.from(next[0].inlineDatum).toString('hex'), expected,
    'only new contact approval may change; immutable recovery config persists');
  assert.equal(emulator.submitTx(signed).isSuccess, false, 'approval replay rejected');
  assert.equal(candidate.liveActions.transactionSubmissionAuthorized, false);
  assert.equal(candidate.checks.fullPhaseOneValidated, false);
});

test('real Scalus rejects unsigned, owner-forged, other-contact and expired approvals', () => {
  for (const variant of ['unsigned', 'owner', 'other-contact', 'expired']) {
    const { emulator, ref, candidate, signed } = localHeartbeatThenApproval();
    let attempted;
    if (variant === 'unsigned') {
      attempted = Buffer.from(candidate.transaction.cborHex, 'hex');
    } else if (variant === 'expired') {
      emulator.setSlot(candidate.validity.upperSlot + 1);
      attempted = signed;
    } else {
      const tx = CSL.Transaction.from_bytes(signed);
      const witnesses = CSL.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
      const vkeys = CSL.Vkeywitnesses.new();
      const bodyHash = CSL.TransactionHash.from_bytes(blake2b(tx.body().to_bytes(), { dkLen: 32 }));
      vkeys.add(CSL.make_vkey_witness(bodyHash, variant === 'owner' ? privateKey : contactBKey));
      witnesses.set_vkeys(vkeys);
      attempted = CSL.Transaction.new(tx.body(), witnesses, undefined).to_bytes();
    }
    const rejected = emulator.submitTx(attempted);
    assert.equal(rejected.isSuccess, false, 'reject ' + variant);
    assert.equal(emulator.getUtxos({ outRefs: [ref] }).length, 1,
      'rejected approval must leave previous protected state unspent');
  }
});


// Sequential second contact: consumes the *actual* accepted first-approval
// UTxO; never a disconnected fabricated state. Hashes/observations remain
// explicitly synthetic test-only metadata, not public ledger attestations.
function localTwoContactApprovedLedger() {
  const phase = localHeartbeatThenApproval();
  const first = phase.emulator.submitTx(phase.signed);
  assert.equal(first.isSuccess, true, 'first approval: '+first.errorRule+' '+first.error);
  const ref = { txHash: first.txHash, outputIndex: 0 };
  const predecessor = phase.emulator.getUtxos({ outRefs: [ref] });
  assert.equal(predecessor.length, 1);
  const datumHex = Buffer.from(predecessor[0].inlineDatum).toString('hex');
  const ownerHash = privateKey.to_public().hash().to_hex();
  assert.equal(datumHex, createCardanoVaultDatumData({
    ownerKeyHash: ownerHash, rescueKeyHash: '66'.repeat(28),
    contactKeyHashes: approvalContacts, threshold: 2, inactivityMs: 60000,
    lastHeartbeatMs: phase.candidate.stateTransition.lastHeartbeatMs,
    approvalKeyHashes: [approvalContacts[0]]
  }).to_hex(), 'second approval must consume first approval datum from ledger');
  const { planSha256: _sha, ...oldCore } = phase.approvalPlan;
  const core = {
    ...oldCore,
    predecessorStateEvidenceSha256: 'cb'.repeat(32), // synthetic local-only reference
    predecessorTransactionBodyHash: first.txHash,
    predecessorObservedTip: { hash: 'cc'.repeat(32), slot: SLOT + 240 },
    stateInput: { transaction: { id: first.txHash }, index: 0 },
    selectedContactKeyHash: approvalContacts[1],
    contactFundingInput: { transaction: { id: CONTACT_B_FUNDING_TXID }, index: 0 },
    contactFundingAddress: contactBAddress,
    contactCollateralInput: { transaction: { id: CONTACT_B_COLLATERAL_TXID }, index: 0 },
    contactCollateralAddress: contactBAddress,
    protectedState: {
      ...oldCore.protectedState,
      predecessorInlineDatumCborHex: datumHex,
      predecessorApprovalKeyHashes: [approvalContacts[0]],
      nextApprovalKeyHashes: [...approvalContacts]
    }
  };
  const approvalPlan = { ...core, planSha256: hashCardanoEvidence(core) };
  const stableTip = { hash: 'cd'.repeat(32), slot: SLOT + 300 };
  phase.emulator.setSlot(stableTip.slot);
  const args = {
    approvalPlan,
    appliedValidatorIdentity: phase.setup.appliedValidatorIdentity,
    parameters: phase.params, recoveryConfig: phase.recoveryConfig,
    stableTip
  };
  const evaluationCandidate = buildCardanoPreprodRealApprovalCandidate({ ...args, evaluationMode: true });
  assert.equal(evaluationCandidate.liveActions.transactionSubmissionAuthorized, false);
  const evaluation = phase.emulator.evaluateTx(Buffer.from(evaluationCandidate.transaction.cborHex,'hex'));
  assert.equal(evaluation.length, 1);
  assert.equal(evaluation[0].tag, 'Spend');
  const budget = {
    memory: (BigInt(evaluation[0].budget.memory)*115n/100n+1n).toString(),
    steps: (BigInt(evaluation[0].budget.steps)*115n/100n+1n).toString()
  };
  const candidate = buildCardanoPreprodRealApprovalCandidate({ ...args, evaluationMode:false,spendBudget:budget });
  assert.deepEqual(candidate.stateTransition.predecessorApprovals, [approvalContacts[0]]);
  assert.deepEqual(candidate.stateTransition.nextApprovals, approvalContacts);
  const unsigned = CSL.Transaction.from_hex(candidate.transaction.cborHex);
  const witnesses = CSL.TransactionWitnessSet.from_bytes(unsigned.witness_set().to_bytes());
  const vkeys = CSL.Vkeywitnesses.new();
  const bodyHash = CSL.TransactionHash.from_bytes(blake2b(unsigned.body().to_bytes(), { dkLen:32 }));
  vkeys.add(CSL.make_vkey_witness(bodyHash, contactBKey));
  witnesses.set_vkeys(vkeys);
  const signed = CSL.Transaction.new(unsigned.body(),witnesses,undefined).to_bytes();
  return { ...phase, first, firstRef:ref, secondCandidate:candidate,
    secondSigned:signed, secondPlan:approvalPlan };
}

test('real Scalus accepts the independently signed second contact approval to reach immutable threshold 2',()=>{
  const phase = localTwoContactApprovedLedger();
  const second = phase.emulator.submitTx(phase.secondSigned);
  assert.equal(second.isSuccess,true,'second approval: '+second.errorRule+' '+second.error);
  assert.equal(phase.emulator.getUtxos({outRefs:[phase.firstRef]}).length,0);
  const state = phase.emulator.getUtxos({outRefs:[{txHash:second.txHash,outputIndex:0}]});
  assert.equal(state.length,1);
  assert.equal(state[0].address,phase.setup.appliedValidatorIdentity.recoveryVault.address);
  assert.equal(state[0].value.coin,10_000_000n);
  assert.equal(state[0].value.assets.length,1);
  assert.equal(Buffer.from(state[0].inlineDatum).toString('hex'),createCardanoVaultDatumData({
    ownerKeyHash: privateKey.to_public().hash().to_hex(),
    rescueKeyHash:'66'.repeat(28),contactKeyHashes:approvalContacts,
    threshold:2,inactivityMs:60000,
    lastHeartbeatMs:phase.secondCandidate.stateTransition.lastHeartbeatMs,
    approvalKeyHashes:approvalContacts
  }).to_hex());
  assert.equal(phase.emulator.submitTx(phase.secondSigned).isSuccess,false,'no replay');
  assert.equal(phase.secondCandidate.liveActions.transactionSubmissionAuthorized,false);
  assert.equal(phase.secondCandidate.checks.fullPhaseOneValidated,false);
});

test('real Scalus rejects missing or wrong second contact witness without consuming one-contact state',()=>{
 for(const mode of ['missing','first-contact','owner','expired']){
  const phase=localTwoContactApprovedLedger();
  let signed=phase.secondSigned;
  if(mode==='missing') signed=Buffer.from(phase.secondCandidate.transaction.cborHex,'hex');
  else if(mode==='expired') phase.emulator.setSlot(phase.secondCandidate.validity.upperSlot+1);
  else {
   const tx=CSL.Transaction.from_bytes(signed);
   const witness=CSL.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
   const sigs=CSL.Vkeywitnesses.new();
   const bodyHash=CSL.TransactionHash.from_bytes(blake2b(tx.body().to_bytes(),{dkLen:32}));
   sigs.add(CSL.make_vkey_witness(bodyHash,mode==='owner'?privateKey:contactAKey));
   witness.set_vkeys(sigs);
   signed=CSL.Transaction.new(tx.body(),witness,undefined).to_bytes();
  }
  const denied=phase.emulator.submitTx(signed);
  assert.equal(denied.isSuccess,false,'reject '+mode);
  assert.equal(phase.emulator.getUtxos({outRefs:[phase.firstRef]}).length,1);
 }
});


// Only synthetic Scalus fixture evidence is produced here. This never
// represents a submitted transaction or independently observed public Preprod.
function localApprovedExecution(){
 const phase=localTwoContactApprovedLedger();
 const approved=phase.emulator.submitTx(phase.secondSigned);
 assert.equal(approved.isSuccess,true,'second approval: '+approved.errorRule+' '+approved.error);
 const approvedRef={txHash:approved.txHash,outputIndex:0};
 const state=phase.emulator.getUtxos({outRefs:[approvedRef]});
 assert.equal(state.length,1);
 const datumHex=Buffer.from(state[0].inlineDatum).toString('hex');
 const ownerHash=privateKey.to_public().hash().to_hex();
 const expected=createCardanoVaultDatumData({
  ownerKeyHash:ownerHash,rescueKeyHash:'66'.repeat(28),
  contactKeyHashes:approvalContacts,threshold:2,inactivityMs:60000,
  lastHeartbeatMs:phase.secondCandidate.stateTransition.lastHeartbeatMs,
  approvalKeyHashes:approvalContacts
 }).to_hex();
 assert.equal(datumHex,expected,'actual Scalus predecessor must contain two approvals');
 const fRef={txHash:phase.heartbeat.txHash,outputIndex:1};
 const funding=phase.emulator.getUtxos({outRefs:[fRef]});
 assert.equal(funding.length,1,'external owner change pays execute fee');
 const identity=phase.setup.appliedValidatorIdentity;
 const evidenceCore={
  schema:'omegavault.cardano.preprod-active-state-evidence.v1',
  network:'preprod',sourceAction:'approve',transactionBodyHash:approved.txHash,
  sourceArtifactSha256:'da'.repeat(32),validatorIdentitySha256:identity.identitySha256,
  observedTip:{hash:'db'.repeat(32),slot:SLOT+300},
  stateReference:{transaction:{id:approved.txHash},index:0},
  state:{
   address:identity.recoveryVault.address,lovelace:'10000000',
   beaconPolicyId:identity.stateBeacon.policyId,
   beaconAssetNameHex:identity.assetNameHex,beaconQuantity:'1',
   inlineDatumCborHex:datumHex,ownerPaymentKeyHash:ownerHash,
   rescueKeyHash:'66'.repeat(28),contactKeyHashes:approvalContacts,
   threshold:2,inactivityMs:60000,
   lastHeartbeatMs:phase.secondCandidate.stateTransition.lastHeartbeatMs,
   approvalKeyHashes:approvalContacts
  },
  checks:{inclusionObserved:true,exactActiveStateObserved:true,finalityProven:false},
  liveActions:{
   walletSigningPerformed:true,transactionSubmissionPerformed:true,
   transactionSubmissionAuthorized:false,liveValueMovementAuthorized:false,
   publicNetworkRecoveryProven:false,supportClaimAuthorized:false
  },
  authorityBoundary:'LOCAL_SCALUS_FIXTURE_ONLY_NO_PUBLIC_SUBMISSION'
 };
 const evidence={...evidenceCore,stateEvidenceSha256:hashCardanoEvidence(evidenceCore)};
 const role=(txId,index,love)=>({
   transaction:{id:txId},index,address,value:{ada:{lovelace:String(love)}}
 });
 const executePlan=createCardanoPreprodRealExecutePlan({
  predecessorStateEvidence:evidence,
  expectedPredecessorStateSha256:evidence.stateEvidenceSha256,
  feePayerKeyHash:ownerHash,
  executorFundingUtxo:role(fRef.txHash,fRef.outputIndex,funding[0].value.coin),
  executorCollateralUtxo:role(phase.setup.collateralRef.transaction.id,
    phase.setup.collateralRef.index,5_000_000n)
 });
 const stableTip={hash:'dc'.repeat(32),slot:SLOT+360};
 phase.emulator.setSlot(stableTip.slot);
 const args={executePlan,appliedValidatorIdentity:identity,
  parameters:phase.params,recoveryConfig:phase.recoveryConfig,stableTip};
 const initial=buildCardanoPreprodRealExecuteCandidate({...args,evaluationMode:true});
 assert.equal(initial.checks.thresholdSatisfied,true);
 assert.equal(initial.recovery.protectedLovelace,'10000000');
 const evaluated=phase.emulator.evaluateTx(Buffer.from(initial.transaction.cborHex,'hex'));
 assert.equal(evaluated.length,2,'must evaluate both mint and spend validators');
 const measured={};
 for(const item of evaluated){
  assert.ok(['Mint','Spend'].includes(item.tag));
  assert.equal(measured[item.tag],undefined);
  measured[item.tag]={
   memory:(BigInt(item.budget.memory)*115n/100n+1n).toString(),
   steps:(BigInt(item.budget.steps)*115n/100n+1n).toString()
  };
 }
 assert.ok(measured.Mint&&measured.Spend);
 const candidate=buildCardanoPreprodRealExecuteCandidate({
  ...args,evaluationMode:false,spendBudget:measured.Spend,mintBudget:measured.Mint
 });
 assert.equal(candidate.recovery.stateBeaconBurnQuantity,'-1');
 assert.equal(candidate.recovery.continuingStateOutputCount,0);
 assert.equal(candidate.liveActions.transactionSubmissionAuthorized,false);
 const unsigned=CSL.Transaction.from_hex(candidate.transaction.cborHex);
 const witnesses=CSL.TransactionWitnessSet.from_bytes(unsigned.witness_set().to_bytes());
 const bodyHash=CSL.TransactionHash.from_bytes(blake2b(unsigned.body().to_bytes(),{dkLen:32}));
 const keys=CSL.Vkeywitnesses.new();
 keys.add(CSL.make_vkey_witness(bodyHash,privateKey));
 witnesses.set_vkeys(keys);
 const signed=CSL.Transaction.new(unsigned.body(),witnesses,undefined).to_bytes();
 return {...phase,approved,approvedRef,executePlan,candidate,signed};
}

test('real Scalus executes OmegaVault complete fixture recovery lifecycle to immutable rescue',()=>{
 const phase=localApprovedExecution();
 const result=phase.emulator.submitTx(phase.signed);
 assert.equal(result.isSuccess,true,'execute: '+result.errorRule+' '+result.error);
 assert.equal(phase.emulator.getUtxos({outRefs:[phase.approvedRef]}).length,0);
 assert.equal(phase.emulator.getUtxos({
  address:phase.setup.appliedValidatorIdentity.recoveryVault.address
 }).length,0,'no continuing recovery state');
 const expectedRescue=CSL.EnterpriseAddress.new(0,CSL.Credential.from_keyhash(
  CSL.Ed25519KeyHash.from_hex('66'.repeat(28)))).to_address().to_bech32();
 const paid=phase.emulator.getUtxos({outRefs:[{txHash:result.txHash,outputIndex:0}]});
 assert.equal(paid.length,1);
 assert.equal(paid[0].address,expectedRescue,'destination is immutable');
 assert.equal(paid[0].value.coin,10_000_000n,'full protected amount rescued');
 assert.equal(paid[0].value.assets.length,0,'beacon must burn exactly once');
 assert.equal(phase.emulator.submitTx(phase.signed).isSuccess,false);
 assert.equal(phase.candidate.checks.fullPhaseOneValidated,false);
 assert.equal(phase.candidate.liveActions.publicNetworkRecoveryProven,false);
});
