import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  createCardanoPreprodInitializeStateObservationEvidence,
  verifyCardanoPreprodInitializeStateObservationEvidence
} from '../src/chains/cardano/preprod-initialize-state-observation.js';

const protocolSnapshot = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_PREPROD_PROTOCOL_PARAMETERS_EPOCH_316.json', import.meta.url), 'utf8'));
protocolSnapshot.source.independentSourceCount = 2;
protocolSnapshot.promotion.independentlyConfirmed = true;
protocolSnapshot.parameters.maxValueSize = 5000;
const parameters = normalizeCardanoProtocolParameterSnapshot(protocolSnapshot);
const fixtureEvidence = JSON.parse(readFileSync(new URL('../docs/evidence/CARDANO_APPLIED_FIXTURE_0.6.12.json', import.meta.url), 'utf8'));
const beaconBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/state-beacon.applied.json', import.meta.url), 'utf8'));
const vaultBlueprint = JSON.parse(readFileSync(new URL('../validators/cardano/fixtures/recovery-vault.applied.json', import.meta.url), 'utf8'));
const beaconCompiledCode = beaconBlueprint.validators.find(item => item.title === 'omegavault.state_beacon.mint').compiledCode;
const recoveryCompiledCode = vaultBlueprint.validators.find(item => item.title === 'omegavault.recovery_vault.spend').compiledCode;
const sourceBlueprintSha256 = createHash('sha256')
  .update(readFileSync(new URL('../validators/cardano/plutus.json', import.meta.url)))
  .digest('hex');

const ownerPrivateKey = Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length:32 }, () => 7));
const ownerPublicKey = ownerPrivateKey.to_public();
const ownerKeyHash = ownerPublicKey.hash().to_hex();
const ownerAddress = Cardano.EnterpriseAddress.new(
  0,
  Cardano.Credential.from_keyhash(ownerPublicKey.hash())
).to_address().to_bech32();

const recoveryConfig = Object.freeze({
  rescueKeyHash:'66'.repeat(28),
  contactKeyHashes:['22'.repeat(28), '33'.repeat(28)],
  threshold:2,
  inactivityMs:60000,
  stateLovelace:'10000000'
});

function fixture() {
  const appliedValidatorIdentity = createCardanoPreprodAppliedValidatorIdentity({
    seedReference:{
      transaction:{ id:fixtureEvidence.parameters.seedTxId },
      index:fixtureEvidence.parameters.seedOutputIndex
    },
    assetNameHex:fixtureEvidence.parameters.assetNameHex,
    sourceBlueprintSha256,
    beaconCompiledCode,
    recoveryCompiledCode,
    aikenPolicyId:fixtureEvidence.stateBeacon.policyId,
    aikenRecoveryHash:fixtureEvidence.recoveryVault.scriptHash,
    aikenRecoveryAddress:fixtureEvidence.recoveryVault.preprodAddress
  });

  const roles={
    seed:{
      transaction:{ id:fixtureEvidence.parameters.seedTxId },
      index:fixtureEvidence.parameters.seedOutputIndex
    },
    collateral:{ transaction:{ id:'12'.repeat(32) }, index:0 }
  };
  const plan=createCardanoPreprodRealUtxoBindingPlan({
    action:'initialize',
    roles,
    appliedValidatorIdentity
  });
  const tip={ hash:'aa'.repeat(32), slot:135700000 };
  const utxoBindingEvidence=createCardanoPreprodRealUtxoBindingEvidence({
    plan,
    tipBefore:tip,
    tipAfter:tip,
    queriedUtxo:[
      { ...roles.seed, address:ownerAddress, value:{ ada:{ lovelace:'20000000' } } },
      { ...roles.collateral, address:ownerAddress, value:{ ada:{ lovelace:'5000000' } } }
    ]
  });

  const unsignedCandidate=buildCardanoPreprodRealInitializeCandidate({
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig,
    evaluationMode:false,
    mintBudget:{ memory:'101167', steps:'30755345' }
  });
  const unsignedPreflight=createCardanoPreprodUnsignedInitializePreflight({
    candidate:unsignedCandidate,
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig
  });

  const unsignedTx=Cardano.Transaction.from_hex(unsignedCandidate.transaction.cborHex);
  const bodyHash=Cardano.TransactionHash.from_bytes(blake2b(unsignedTx.body().to_bytes(), { dkLen:32 }));
  const witnessSet=Cardano.TransactionWitnessSet.from_bytes(unsignedTx.witness_set().to_bytes());
  const vkeys=Cardano.Vkeywitnesses.new();
  vkeys.add(Cardano.make_vkey_witness(bodyHash, ownerPrivateKey));
  witnessSet.set_vkeys(vkeys);
  const signedTransactionCborHex=Cardano.Transaction.new(
    unsignedTx.body(),
    witnessSet,
    unsignedTx.auxiliary_data()
  ).to_hex();

  const walletWitnessEvidence=createCardanoPreprodInitializeWalletWitnessEvidence({
    signedTransactionCborHex,
    unsignedCandidate,
    unsignedPreflight,
    appliedValidatorIdentity,
    utxoBindingEvidence,
    parameters,
    recoveryConfig
  });

  const signedTx=Cardano.Transaction.from_hex(signedTransactionCborHex);
  const stateOutput=signedTx.body().outputs().get(0);
  const observedUtxo={
    transaction:{ id:walletWitnessEvidence.transactionBodyHash },
    index:0,
    address:appliedValidatorIdentity.recoveryVault.address,
    value:{
      ada:{ lovelace:recoveryConfig.stateLovelace },
      [appliedValidatorIdentity.stateBeacon.policyId]:{
        [appliedValidatorIdentity.assetNameHex]:'1'
      }
    },
    datum:Buffer.from(stateOutput.plutus_data().to_bytes()).toString('hex')
  };

  return {
    appliedValidatorIdentity,
    signedTransactionCborHex,
    walletWitnessEvidence,
    observedTip:{ hash:'bb'.repeat(32), slot:135701000 },
    observedUtxo
  };
}

test('Cardano initialize state observation binds the exact active state UTxO without claiming finality', () => {
  const input=fixture();
  const evidence=createCardanoPreprodInitializeStateObservationEvidence({
    ...input,
    recoveryConfig
  });
  assert.equal(evidence.transactionBodyHash, input.walletWitnessEvidence.transactionBodyHash);
  assert.deepEqual(evidence.stateReference, {
    transaction:{ id:input.walletWitnessEvidence.transactionBodyHash },
    index:0
  });
  assert.equal(evidence.checks.exactStateOutputReferenceObserved, true);
  assert.equal(evidence.checks.exactRecoveryValidatorAddressObserved, true);
  assert.equal(evidence.checks.exactProtectedLovelaceObserved, true);
  assert.equal(evidence.checks.exactSingleBeaconObserved, true);
  assert.equal(evidence.checks.exactConfiguredInlineDatumObserved, true);
  assert.equal(Number.isSafeInteger(evidence.stateObservation.lastHeartbeatMs), true);
  assert.deepEqual(evidence.stateObservation.approvalKeyHashes, []);
  assert.equal(evidence.checks.inclusionObserved, true);
  assert.equal(evidence.checks.finalityProven, false);
  assert.equal(evidence.liveActions.transactionSubmissionPerformed, true);
  assert.equal(evidence.liveActions.transactionSubmissionAuthorized, false);
  assert.equal(evidence.liveActions.publicNetworkRecoveryProven, false);
  assert.match(evidence.observationSha256, /^[0-9a-f]{64}$/);

  const verified=verifyCardanoPreprodInitializeStateObservationEvidence({
    evidence,
    ...input,
    recoveryConfig
  });
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('Cardano initialize state observation rejects a redirected recovery state UTxO', () => {
  const input=fixture();
  assert.throws(
    () => createCardanoPreprodInitializeStateObservationEvidence({
      ...input,
      observedUtxo:{ ...input.observedUtxo, address:ownerAddress },
      recoveryConfig
    }),
    /address differs/
  );
});

test('Cardano initialize state observation rejects missing or altered beacon state', () => {
  const input=fixture();
  assert.throws(
    () => createCardanoPreprodInitializeStateObservationEvidence({
      ...input,
      observedUtxo:{
        ...input.observedUtxo,
        value:{ ada:{ lovelace:recoveryConfig.stateLovelace } }
      },
      recoveryConfig
    }),
    /asset policies/
  );
});

test('Cardano initialize state observation rejects altered protected value', () => {
  const input=fixture();
  assert.throws(
    () => createCardanoPreprodInitializeStateObservationEvidence({
      ...input,
      observedUtxo:{
        ...input.observedUtxo,
        value:{
          ...input.observedUtxo.value,
          ada:{ lovelace:'9999999' }
        }
      },
      recoveryConfig
    }),
    /lovelace differs/
  );
});

test('Cardano initialize state observation rejects altered inline datum', () => {
  const input=fixture();
  assert.throws(
    () => createCardanoPreprodInitializeStateObservationEvidence({
      ...input,
      observedUtxo:{ ...input.observedUtxo, datum:'80' },
      recoveryConfig
    }),
    /inline datum differs/
  );
});
