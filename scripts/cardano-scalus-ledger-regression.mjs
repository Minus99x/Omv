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


import assert from 'node:assert/strict';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { CardanoInfo, Emulator, Utxo, Value } from 'scalus';

const TEST_TXID = 'ab'.repeat(32);
const SLOT = 135700000;
const COIN = 1_000_000_000n;
const privateKey = CSL.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 9));
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
function locallySignedOmegaVaultInitialize() {
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
      contactKeyHashes: ['22'.repeat(28), '33'.repeat(28)],
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

function omegaVaultInitializeLedger(a, slot = SLOT) {
  return Emulator.create(CardanoInfo.preprod(), {
    slot,
    utxos: [
      // Scalus Value.ada(x) multiplies ADA by 1e6. UTxOs contain lovelace.
      new Utxo(a.seedRef.transaction.id, a.seedRef.index, address, new Value(20_000_000n)),
      new Utxo(a.collateralRef.transaction.id, a.collateralRef.index, address, new Value(5_000_000n))
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
