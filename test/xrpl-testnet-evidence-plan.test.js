import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createXrplTestnetPrimitiveEvidencePlan,
  getXrplPrimitiveEvidenceSpec
} from '../src/chains/xrpl/testnet-evidence-plan.js';

test('XRPL Testnet evidence plan keeps primitive proofs separate from exact OmegaVault recovery',()=>{
  const plan=createXrplTestnetPrimitiveEvidencePlan();
  assert.equal(plan.networkRef,'xrpl:testnet');
  assert.equal(plan.evidenceLevel,'public-testnet');
  assert.equal(plan.claimBoundary.exactOmegaVaultRecoveryProven,false);
  assert.equal(plan.claimBoundary.publicNetworkRecoveryProven,false);
  assert.equal(plan.claimBoundary.supportClaimAuthorized,false);
  assert.ok(plan.requiredFeatures.includes('PermissionDelegationV1_1'));
  assert.ok(plan.requiredFeatures.includes('BatchV1_1'));
  assert.ok(plan.requiredFeatures.includes('TicketBatch'));
});

test('XRPL primitive evidence plan fails closed on unknown primitive names',()=>{
  assert.throws(
    ()=>createXrplTestnetPrimitiveEvidencePlan({ primitives:['signerList','magicRecovery'] }),
    /unknown/
  );
});

test('XRPL feature activation must be observed on the target network rather than inferred from docs',()=>{
  const plan=createXrplTestnetPrimitiveEvidencePlan({ primitives:['permissionDelegation'] });
  assert.equal(plan.featurePolicy.queryTargetNetworkAtCaptureTime,true);
  assert.equal(plan.featurePolicy.documentationDoesNotEstablishActivation,true);
  assert.equal(plan.featurePolicy.unknownOrDisabledFeatureFailsClosed,true);
});

test('XRPL escrow evidence explicitly proves fixed-time semantics but not resettable inactivity or quorum',()=>{
  const escrow=getXrplPrimitiveEvidenceSpec('escrow');
  assert.ok(escrow.proves.includes('immutable-escrow-destination'));
  assert.ok(escrow.doesNotProve.includes('owner-resettable-inactivity'));
  assert.ok(escrow.doesNotProve.includes('trusted-contact-threshold'));
});

test('XRPL Ticket evidence proves one-use sequence reservation but not intent binding',()=>{
  const ticket=getXrplPrimitiveEvidenceSpec('ticket');
  assert.ok(ticket.proves.includes('one-use-sequence-reservation'));
  assert.ok(ticket.doesNotProve.includes('transaction-intent-binding'));
});

test('XRPL Batch evidence retains non-delegable outer transaction caution',()=>{
  const batch=getXrplPrimitiveEvidenceSpec('batch');
  assert.match(batch.caution,/non-delegable/i);
  assert.ok(batch.doesNotProve.includes('immutable-rescue'));
});
