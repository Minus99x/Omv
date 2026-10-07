import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CARDANO_PREPROD_NETWORK_ID } from '../src/chains/cardano/transaction-body.js';
import { normalizeCardanoProtocolParameterSnapshot } from '../src/chains/cardano/protocol-parameters.js';
import { createCardanoPreprodAppliedValidatorIdentity } from '../src/chains/cardano/live-validator-identity.js';
import {
  createCardanoPreprodRealUtxoBindingEvidence,
  createCardanoPreprodRealUtxoBindingPlan
} from '../src/chains/cardano/preprod-real-utxo-binding.js';
import { buildCardanoPreprodRealInitializeCandidate } from '../src/chains/cardano/preprod-real-initialize.js';
import { createCardanoPreprodUnsignedInitializePreflight } from '../src/chains/cardano/preprod-unsigned-initialize-preflight.js';
import { createCardanoPreprodInitializeWalletWitnessEvidence } from '../src/chains/cardano/preprod-initialize-wallet-witness.js';
import {
  createCardanoPreprodInitializePreSubmitEvidence,
  verifyCardanoPreprodInitializePreSubmitEvidence
} from '../src/chains/cardano/preprod-initialize-presubmit.js';

const snapshot = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
snapshot.source.independentSourceCount = 2;
snapshot.promotion.independentlyConfirmed = true;
const parameters = normalizeCardanoProtocolParameterSnapshot(snapshot);
const fixtureEvidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json', import.meta.url), 'utf8'));
const beaconBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vaultBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;
const sourceBlueprintSha256 = createHash('sha256')
  .update(readFileSync(new URL('../validators/cardano/plutus.json', import.meta.url)))
  .digest('hex');

const ownerPrivateKey = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length: 32 }, () => 9));
const ownerPublicKey = ownerPrivateKey.to_public();
const ownerAddress = Cardano.EnterpriseAddress.new(
  CARDANO_PREPROD_NETWORK_ID,
  Cardano.Credential.from_keyhash(ownerPublicKey.hash())
).to_address().to_bech32();

const recoveryConfig = Object.freeze({
  rescueKeyHash: '66'.repeat(28),
  contactKeyHashes: ['22'.repeat(28), '33'.repeat(28)],
  threshold: 2,
  inactivityMs: 60000,
  stateLovelace: '10000000'
});

function fixture() {
  const appliedValidatorIdentity = createCardanoPreprodAppliedValidatorIdentity({
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
    appliedValidatorIdentity
  });
  const boundTip = { hash: 'aa'.repeat(32), slot: 135700000 };
  const queriedUtxo = [
    { ...roles.seed, address: ownerAddress, value: { ada: { lovelace: '20000000' } } },
    { ...roles.collateral, address: ownerAddress, value: { ada: { lovelace: '5000000' } } }
  ];
  const utxoBindingEvidence = createCardanoPreprodRealUtxoBindingEvidence({
    plan,
    tipBefore: boundTip,
    tipAfter: boundTip,
    queriedUtxo
  });
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

  const unsignedTx = Cardano.Transaction.from_hex(unsignedCandidate.transaction.cborHex);
  const bodyHash = Cardano.TransactionHash.from_bytes(blake2b(unsignedTx.body().to_bytes(), { dkLen: 32 }));
  const witnessSet = Cardano.TransactionWitnessSet.from_bytes(unsignedTx.witness_set().to_bytes());
  const vkeys = Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash, ownerPrivateKey));
  witnessSet.set_vkeys(vkeys);
  const signedTransactionCborHex = Cardano.Transaction.new(
    unsignedTx.body(),
    witnessSet,
    unsignedTx.auxiliary_data()
  ).to_hex();

  const witnessEvidence = createCardanoPreprodInitializeWalletWitnessEvidence({
    signedTransactionCborHex,
    unsignedCandidate,
    unsignedPreflight,
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig
  });

  return {
    appliedValidatorIdentity,
    utxoBindingEvidence,
    unsignedCandidate,
    unsignedPreflight,
    signedTransactionCborHex,
    witnessEvidence,
    currentQueriedUtxo: queriedUtxo
  };
}

test('Cardano initialize pre-submit gate proves freshness without authorizing submission', () => {
  const input = fixture();
  const currentTip = {
    hash: 'bb'.repeat(32),
    slot: input.unsignedCandidate.validity.lowerSlot + 60
  };
  const evidence = createCardanoPreprodInitializePreSubmitEvidence({
    ...input,
    currentParameters: parameters,
    recoveryConfig,
    currentTip
  });
  assert.equal(evidence.checks.seedStillUnspent, true);
  assert.equal(evidence.checks.collateralStillUnspent, true);
  assert.equal(evidence.checks.validityIntervalCurrent, true);
  assert.equal(evidence.checks.walletWitnessEvidenceVerified, true);
  assert.equal(evidence.checks.currentProtocolParametersBoundByDigest, true);
  assert.equal(evidence.checks.signedTransactionSizeWithinCurrentMaximum, true);
  assert.equal(evidence.checks.signedExecutionUnitsWithinCurrentMaximum, true);
  assert.equal(evidence.checks.signedFeeCoversCurrentMinimum, true);
  assert.match(evidence.currentProtocolParametersSha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.signedTransaction.bytes, Cardano.Transaction.from_hex(input.signedTransactionCborHex).to_bytes().length);
  assert.equal(evidence.signedTransaction.feeLovelace, input.unsignedCandidate.transaction.feeLovelace);
  assert.equal(evidence.signedTransaction.currentMinimumFeeLovelace, input.unsignedCandidate.transaction.feeLovelace);
  assert.equal(evidence.checks.preSubmitFreshnessGateComplete, true);
  assert.equal(evidence.checks.completePhaseOneValidated, false);
  assert.equal(evidence.liveActions.transactionSubmissionPerformed, false);
  assert.equal(evidence.liveActions.transactionSubmissionAuthorized, false);
  assert.match(evidence.preSubmitSha256, /^[0-9a-f]{64}$/);

  const verified = verifyCardanoPreprodInitializePreSubmitEvidence({
    evidence,
    ...input,
    currentParameters: parameters,
    recoveryConfig,
    currentTip
  });
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('Cardano initialize pre-submit evidence binds the exact current protocol-parameter set even when the transaction remains valid', () => {
  const input = fixture();
  const currentTip = {
    hash: 'be'.repeat(32),
    slot: input.unsignedCandidate.validity.lowerSlot + 60
  };
  const baseline = createCardanoPreprodInitializePreSubmitEvidence({
    ...input,
    currentParameters: parameters,
    recoveryConfig,
    currentTip
  });
  const changedButCompatibleParameters = Object.freeze({
    ...parameters,
    maxTxSize: parameters.maxTxSize + 1
  });
  const rebound = createCardanoPreprodInitializePreSubmitEvidence({
    ...input,
    currentParameters: changedButCompatibleParameters,
    recoveryConfig,
    currentTip
  });
  assert.notEqual(rebound.currentProtocolParametersSha256, baseline.currentProtocolParametersSha256);
  assert.notEqual(rebound.preSubmitSha256, baseline.preSubmitSha256);
  assert.equal(rebound.checks.signedFeeCoversCurrentMinimum, true);
  assert.equal(rebound.checks.completePhaseOneValidated, false);
});

test('Cardano initialize pre-submit gate fails closed if seed is spent or validity has expired', () => {
  const input = fixture();
  const currentTip = {
    hash: 'bb'.repeat(32),
    slot: input.unsignedCandidate.validity.lowerSlot + 60
  };
  assert.throws(
    () => createCardanoPreprodInitializePreSubmitEvidence({
      ...input,
      currentParameters: parameters,
      recoveryConfig,
      currentTip,
      currentQueriedUtxo: [input.currentQueriedUtxo[1]]
    }),
    /exactly the bound seed and collateral|seed UTxO/
  );

  assert.throws(
    () => createCardanoPreprodInitializePreSubmitEvidence({
      ...input,
      currentParameters: parameters,
      recoveryConfig,
      currentTip: {
        hash: 'cc'.repeat(32),
        slot: input.unsignedCandidate.validity.upperSlot + 1
      }
    }),
    /expired/
  );
});

test('Cardano initialize pre-submit gate fails closed on current input value drift', () => {
  const input = fixture();
  const drifted = structuredClone(input.currentQueriedUtxo);
  drifted[0].value.ada.lovelace = '19999999';
  assert.throws(
    () => createCardanoPreprodInitializePreSubmitEvidence({
      ...input,
      currentParameters: parameters,
      recoveryConfig,
      currentTip: {
        hash: 'dd'.repeat(32),
        slot: input.unsignedCandidate.validity.lowerSlot + 60
      },
      currentQueriedUtxo: drifted
    }),
    /value differs|lovelace differs/
  );
});
