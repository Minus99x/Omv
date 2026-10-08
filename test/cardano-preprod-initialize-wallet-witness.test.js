import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CARDANO_PREPROD_NETWORK_ID
} from '../src/chains/cardano/transaction-body.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
import {
  createCardanoPreprodRealUtxoBindingEvidence,
  createCardanoPreprodRealUtxoBindingPlan
} from '../src/chains/cardano/preprod-real-utxo-binding.js';
import { buildCardanoPreprodRealInitializeCandidate } from '../src/chains/cardano/preprod-real-initialize.js';
import { createCardanoPreprodUnsignedInitializePreflight } from '../src/chains/cardano/preprod-unsigned-initialize-preflight.js';
import {
  createCardanoPreprodInitializeWalletWitnessEvidence,
  verifyCardanoPreprodInitializeWalletWitnessEvidence
} from '../src/chains/cardano/preprod-initialize-wallet-witness.js';

const protocolSnapshot = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
protocolSnapshot.source.independentSourceCount = 2;
protocolSnapshot.promotion.independentlyConfirmed = true;
const parameters = normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);
const fixtureEvidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json', import.meta.url), 'utf8'));
const beaconBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vaultBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;
const sourceBlueprintSha256 = createHash('sha256')
  .update(readFileSync(new URL('../validators/cardano/plutus.json', import.meta.url)))
  .digest('hex');

const ownerPrivateKey = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 7));
const ownerPublicKey = ownerPrivateKey.to_public();
const ownerKeyHash = ownerPublicKey.hash().to_hex();
const ownerAddress = Cardano.EnterpriseAddress.new(
  CARDANO_PREPROD_NETWORK_ID,
  Cardano.Credential.from_keyhash(ownerPublicKey.hash())
).to_address().to_bech32();

function identity() {
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

function binding(appliedIdentity) {
  const roles = {
    seed: {
      transaction: { id: fixtureEvidence.parameters.seedTxId },
      index: fixtureEvidence.parameters.seedOutputIndex
    },
    collateral: { transaction: { id: '12'.repeat(32) }, index: 0 }
  };
  const plan = createCardanoPreprodRealUtxoBindingPlan({
    action: 'initialize',
    roles,
    appliedValidatorIdentity: appliedIdentity
  });
  const tip = { hash: 'aa'.repeat(32), slot: 135700000 };
  return createCardanoPreprodRealUtxoBindingEvidence({
    plan,
    tipBefore: tip,
    tipAfter: tip,
    queriedUtxo: [
      { ...roles.seed, address: ownerAddress, value: { ada: { lovelace: '20000000' } } },
      { ...roles.collateral, address: ownerAddress, value: { ada: { lovelace: '5000000' } } }
    ]
  });
}

const recoveryConfig = Object.freeze({
  rescueKeyHash: '66'.repeat(28),
  contactKeyHashes: ['22'.repeat(28), '33'.repeat(28)],
  threshold: 2,
  inactivityMs: 60000,
  stateLovelace: '10000000'
});

function fixture() {
  const appliedValidatorIdentity = identity();
  const utxoBindingEvidence = binding(appliedValidatorIdentity);
  assert.equal(utxoBindingEvidence.walletPaymentKeyHash, ownerKeyHash);
  const unsignedCandidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: false,
    mintBudget: { memory: '101167', steps: '30755345' }
  });
  const unsignedPreflight = createCardanoPreprodUnsignedInitializePreflight({
    candidate: unsignedCandidate,
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig
  });
  return { appliedValidatorIdentity, utxoBindingEvidence, unsignedCandidate, unsignedPreflight };
}

function signCandidate(candidate, privateKey = ownerPrivateKey) {
  const unsignedTx = Cardano.Transaction.from_hex(candidate.transaction.cborHex);
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(unsignedTx.body().to_bytes(), { dkLen: 32 }));
  const witnessSet = Cardano.TransactionWitnessSet.from_bytes(unsignedTx.witness_set().to_bytes());
  const vkeys = Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash, privateKey));
  witnessSet.set_vkeys(vkeys);
  return Cardano.Transaction.new(unsignedTx.body(), witnessSet, unsignedTx.auxiliary_data()).to_hex();
}

test('Cardano initialize wallet witness verifier accepts exactly one valid owner witness without authorizing submission', () => {
  const input = fixture();
  const signedTransactionCborHex = signCandidate(input.unsignedCandidate);
  const evidence = createCardanoPreprodInitializeWalletWitnessEvidence({
    signedTransactionCborHex,
    ...input,
    parameters,
    recoveryConfig
  });
  assert.equal(evidence.ownerPaymentKeyHash, ownerKeyHash);
  assert.equal(evidence.witnessCount, 1);
  assert.equal(evidence.signedTransactionCborHex, signedTransactionCborHex);
  assert.equal(
    evidence.signedTransactionSha256,
    createHash('sha256').update(Buffer.from(signedTransactionCborHex, 'hex')).digest('hex')
  );
  assert.equal(evidence.checks.exactWalletProducedSignedBytesPreserved, true);
  assert.equal(evidence.checks.signedTransactionCanonicalRoundTripExact, true);
  assert.equal(evidence.checks.exactUnsignedBodyPreserved, true);
  assert.equal(evidence.checks.nonWalletWitnessesPreserved, true);
  assert.equal(evidence.checks.ownerSignatureCryptographicallyValid, true);
  assert.equal(evidence.checks.walletWitnessesValidated, true);
  assert.equal(evidence.checks.completePhaseOneValidated, false);
  assert.equal(evidence.liveActions.walletSigningPerformed, true);
  assert.equal(evidence.liveActions.transactionSubmissionPerformed, false);
  assert.equal(evidence.liveActions.transactionSubmissionAuthorized, false);
  assert.match(evidence.witnessEvidenceSha256, /^[0-9a-f]{64}$/);

  const verified = verifyCardanoPreprodInitializeWalletWitnessEvidence({
    evidence,
    signedTransactionCborHex,
    ...input,
    parameters,
    recoveryConfig
  });
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('Cardano initialize wallet witness evidence preserves exact signed bytes while normalizing only hex case', () => {
  const input = fixture();
  const signedTransactionCborHex = signCandidate(input.unsignedCandidate);
  const uppercaseHex = signedTransactionCborHex.toUpperCase();
  const evidence = createCardanoPreprodInitializeWalletWitnessEvidence({
    signedTransactionCborHex: uppercaseHex,
    ...input,
    parameters,
    recoveryConfig
  });
  assert.equal(evidence.signedTransactionCborHex, signedTransactionCborHex);
  assert.equal(
    evidence.signedTransactionSha256,
    createHash('sha256').update(Buffer.from(signedTransactionCborHex, 'hex')).digest('hex')
  );
  assert.equal(evidence.checks.exactWalletProducedSignedBytesPreserved, true);
  assert.equal(evidence.checks.signedTransactionCanonicalRoundTripExact, true);
  assert.equal(evidence.checks.completePhaseOneValidated, false);
  assert.equal(evidence.liveActions.transactionSubmissionAuthorized, false);
});


test('Cardano initialize wallet witness verifier rejects a false transaction validity flag', () => {
  const input = fixture();
  const signedTx = Cardano.Transaction.from_hex(signCandidate(input.unsignedCandidate));
  signedTx.set_is_valid(false);
  assert.throws(
    () => createCardanoPreprodInitializeWalletWitnessEvidence({
      signedTransactionCborHex: signedTx.to_hex(),
      ...input,
      parameters,
      recoveryConfig
    }),
    /must carry a true transaction validity flag/
  );
});

test('Cardano initialize wallet witness verifier rejects a missing owner VKey witness', () => {
  const input = fixture();
  assert.throws(
    () => createCardanoPreprodInitializeWalletWitnessEvidence({
      signedTransactionCborHex: input.unsignedCandidate.transaction.cborHex,
      ...input,
      parameters,
      recoveryConfig
    }),
    /exactly one VKey witness/
  );
});

test('Cardano initialize wallet witness verifier rejects extra VKey witnesses even when the owner witness is valid', () => {
  const input = fixture();
  const unsignedTx = Cardano.Transaction.from_hex(input.unsignedCandidate.transaction.cborHex);
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(unsignedTx.body().to_bytes(), { dkLen: 32 }));
  const witnessSet = Cardano.TransactionWitnessSet.from_bytes(unsignedTx.witness_set().to_bytes());
  const vkeys = Cardano.Vkeywitnesses.new();
  const extraKey = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 8));
  vkeys.add(Cardano.make_vkey_witness(bodyHash, ownerPrivateKey));
  vkeys.add(Cardano.make_vkey_witness(bodyHash, extraKey));
  witnessSet.set_vkeys(vkeys);
  const signedWithExtraWitness = Cardano.Transaction.new(
    unsignedTx.body(),
    witnessSet,
    unsignedTx.auxiliary_data()
  ).to_hex();

  assert.throws(
    () => createCardanoPreprodInitializeWalletWitnessEvidence({
      signedTransactionCborHex: signedWithExtraWitness,
      ...input,
      parameters,
      recoveryConfig
    }),
    /exactly one VKey witness/
  );
});

test('Cardano initialize wallet witness verifier rejects altered non-wallet witness material', () => {
  const input = fixture();
  const signedTx = Cardano.Transaction.from_hex(signCandidate(input.unsignedCandidate));
  const witnessSet = Cardano.TransactionWitnessSet.from_bytes(signedTx.witness_set().to_bytes());
  witnessSet.set_redeemers(Cardano.Redeemers.new());
  const mutated = Cardano.Transaction.new(
    signedTx.body(),
    witnessSet,
    signedTx.auxiliary_data()
  ).to_hex();

  assert.throws(
    () => createCardanoPreprodInitializeWalletWitnessEvidence({
      signedTransactionCborHex: mutated,
      ...input,
      parameters,
      recoveryConfig
    }),
    /changed non-wallet witness material/
  );
});

test('Cardano initialize wallet witness verifier rejects a witness from the wrong payment key', () => {
  const input = fixture();
  const wrongKey = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 8));
  assert.throws(
    () => createCardanoPreprodInitializeWalletWitnessEvidence({
      signedTransactionCborHex: signCandidate(input.unsignedCandidate, wrongKey),
      ...input,
      parameters,
      recoveryConfig
    }),
    /does not match the bound owner payment key/
  );
});

test('Cardano initialize wallet witness verifier rejects an invalid signature for the correct public key', () => {
  const input = fixture();
  const unsignedTx = Cardano.Transaction.from_hex(input.unsignedCandidate.transaction.cborHex);
  const witnessSet = Cardano.TransactionWitnessSet.from_bytes(unsignedTx.witness_set().to_bytes());
  const vkeys = Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.Vkeywitness.new(
    Cardano.Vkey.new(ownerPublicKey),
    ownerPrivateKey.sign(Uint8Array.from([1, 2, 3]))
  ));
  witnessSet.set_vkeys(vkeys);
  const invalidSigned = Cardano.Transaction.new(unsignedTx.body(), witnessSet, unsignedTx.auxiliary_data()).to_hex();

  assert.throws(
    () => createCardanoPreprodInitializeWalletWitnessEvidence({
      signedTransactionCborHex: invalidSigned,
      ...input,
      parameters,
      recoveryConfig
    }),
    /signature is invalid/
  );
});

test('Cardano initialize wallet witness verifier rejects a valid signature over a different transaction body', () => {
  const input = fixture();
  const evaluationCandidate = buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity: input.appliedValidatorIdentity,
    utxoBindingEvidence: input.utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode: true
  });
  assert.throws(
    () => createCardanoPreprodInitializeWalletWitnessEvidence({
      signedTransactionCborHex: signCandidate(evaluationCandidate),
      ...input,
      parameters,
      recoveryConfig
    }),
    /body differs/
  );
});
