import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { hashCardanoEvidence } from '../src/chains/cardano/evidence-binding.js';
import {
  createCardanoPreprodRealHeartbeatPlan,
  verifyCardanoPreprodRealHeartbeatPlan
} from '../src/chains/cardano/preprod-real-heartbeat-plan.js';

const ownerPrivateKey=Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length:32 }, () => 7));
const ownerKeyHash=ownerPrivateKey.to_public().hash().to_hex();
const ownerAddress=Cardano.EnterpriseAddress.new(
  0,
  Cardano.Credential.from_keyhash(ownerPrivateKey.to_public().hash())
).to_address().to_bech32();

function observation() {
  const core={
    schema:'omegavault.cardano.preprod-initialize-state-observation-evidence.v1',
    network:'preprod',
    action:'initialize',
    transactionBodyHash:'aa'.repeat(32),
    signedTransactionSha256:'bb'.repeat(32),
    witnessEvidenceSha256:'cc'.repeat(32),
    validatorIdentitySha256:'dd'.repeat(32),
    observedTip:{ hash:'ee'.repeat(32), slot:135700000 },
    stateReference:{ transaction:{ id:'aa'.repeat(32) }, index:0 },
    stateObservation:{
      address:'addr_test1wfixture',
      valueSha256:'11'.repeat(32),
      lovelace:'10000000',
      beaconPolicyId:'22'.repeat(28),
      beaconAssetNameHex:'4f56',
      beaconQuantity:'1',
      inlineDatumCborHex:'d87980',
      referenceScriptPresent:false
    },
    checks:{
      exactSignedTransactionBound:true,
      exactTransactionBodyHashBound:true,
      exactStateOutputReferenceObserved:true,
      exactRecoveryValidatorAddressObserved:true,
      exactProtectedLovelaceObserved:true,
      exactSingleBeaconObserved:true,
      exactConfiguredInlineDatumObserved:true,
      stateUtxoUnspentAtObservedTip:true,
      inclusionObserved:true,
      finalityProven:false
    },
    liveActions:{
      walletSigningPerformed:true,
      transactionSubmissionPerformed:true,
      transactionSubmissionAuthorized:false,
      liveValueMovementAuthorized:false,
      publicNetworkRecoveryProven:false,
      supportClaimAuthorized:false
    },
    nextGate:'separate-cardano-inclusion-finality-evidence-before-lifecycle-promotion',
    authorityBoundary:'fixture'
  };
  return Object.freeze({ ...core, observationSha256:hashCardanoEvidence(core) });
}

function plainUtxo(txByte, index, lovelace) {
  return {
    transaction:{ id:txByte.repeat(32) },
    index,
    address:ownerAddress,
    value:{ ada:{ lovelace:String(lovelace) } }
  };
}

test('real heartbeat plan binds one observed state plus distinct external owner funding and collateral', () => {
  const stateObservationEvidence=observation();
  const input={
    stateObservationEvidence,
    expectedStateObservationSha256:stateObservationEvidence.observationSha256,
    ownerFundingUtxo:plainUtxo('12', 0, '5000000'),
    collateralUtxo:plainUtxo('34', 1, '4000000'),
    ownerPaymentKeyHash:ownerKeyHash
  };
  const plan=createCardanoPreprodRealHeartbeatPlan(input);
  assert.equal(plan.action, 'heartbeat');
  assert.equal(plan.stateInput.transaction.id, 'aa'.repeat(32));
  assert.equal(plan.externalFunding.feeMustComeFromExternalFunding, true);
  assert.equal(plan.externalFunding.protectedStateMayNotPayFees, true);
  assert.equal(plan.prerequisites.predecessorInclusionObserved, true);
  assert.equal(plan.prerequisites.predecessorFinalityRequiredBeforeLifecyclePromotion, true);
  assert.equal(plan.liveActions.walletSigningAuthorized, false);
  assert.equal(plan.liveActions.transactionSubmissionAuthorized, false);
  assert.equal(plan.liveActions.publicNetworkRecoveryProven, false);
  assert.match(plan.planSha256, /^[0-9a-f]{64}$/);

  const verified=verifyCardanoPreprodRealHeartbeatPlan({ plan, ...input });
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('real heartbeat plan rejects funding controlled by a different owner key', () => {
  const other=Cardano.PrivateKey.from_normal_bytes(Uint8Array.from({ length:32 }, () => 8));
  const otherAddress=Cardano.EnterpriseAddress.new(
    0,
    Cardano.Credential.from_keyhash(other.to_public().hash())
  ).to_address().to_bech32();
  const stateObservationEvidence=observation();

  assert.throws(
    () => createCardanoPreprodRealHeartbeatPlan({
      stateObservationEvidence,
      expectedStateObservationSha256:stateObservationEvidence.observationSha256,
      ownerFundingUtxo:{
        transaction:{ id:'12'.repeat(32) },
        index:0,
        address:otherAddress,
        value:{ ada:{ lovelace:'5000000' } }
      },
      collateralUtxo:plainUtxo('34', 1, '4000000'),
      ownerPaymentKeyHash:ownerKeyHash
    }),
    /not controlled by the bound owner/
  );
});

test('real heartbeat plan rejects asset-bearing funding inputs', () => {
  const stateObservationEvidence=observation();
  const funding=plainUtxo('12', 0, '5000000');
  funding.value['ab'.repeat(28)]={ '4f56':'1' };

  assert.throws(
    () => createCardanoPreprodRealHeartbeatPlan({
      stateObservationEvidence,
      expectedStateObservationSha256:stateObservationEvidence.observationSha256,
      ownerFundingUtxo:funding,
      collateralUtxo:plainUtxo('34', 1, '4000000'),
      ownerPaymentKeyHash:ownerKeyHash
    }),
    /plain ADA-only/
  );
});

test('real heartbeat plan rejects reused state, funding or collateral references', () => {
  const stateObservationEvidence=observation();
  assert.throws(
    () => createCardanoPreprodRealHeartbeatPlan({
      stateObservationEvidence,
      expectedStateObservationSha256:stateObservationEvidence.observationSha256,
      ownerFundingUtxo:{
        transaction:{ id:'aa'.repeat(32) },
        index:0,
        address:ownerAddress,
        value:{ ada:{ lovelace:'5000000' } }
      },
      collateralUtxo:plainUtxo('34', 1, '4000000'),
      ownerPaymentKeyHash:ownerKeyHash
    }),
    /three distinct/
  );
});

test('real heartbeat plan rejects a different predecessor observation digest', () => {
  const stateObservationEvidence=observation();
  assert.throws(
    () => createCardanoPreprodRealHeartbeatPlan({
      stateObservationEvidence,
      expectedStateObservationSha256:'ff'.repeat(32),
      ownerFundingUtxo:plainUtxo('12', 0, '5000000'),
      collateralUtxo:plainUtxo('34', 1, '4000000'),
      ownerPaymentKeyHash:ownerKeyHash
    }),
    /does not match the explicitly selected predecessor evidence/
  );
});
