import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_INVARIANT_IDS } from '../src/core/invariants.js';
import {
  CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS,
  createCardanoPreprodInvariantEvidenceProgram,
  verifyCardanoPreprodInvariantEvidenceProgram
} from '../src/chains/cardano/preprod-invariant-program.js';
import { CARDANO_PREPROD_CAPTURE_BASELINE } from '../src/chains/cardano/preprod-capture-session.js';

test('Cardano Preprod invariant program binds the exact sealed 0.6.57 checkpoint', () => {
  const program = createCardanoPreprodInvariantEvidenceProgram({ checkpoint: CARDANO_PREPROD_CAPTURE_BASELINE });
  assert.deepEqual(program.checkpoint, CARDANO_PREPROD_CAPTURE_BASELINE);
  assert.equal(program.checkpoint.checkpointRef, '0.6.57-dev');
  assert.equal(program.checkpoint.sourceCommitSha, '85ec91ac28b327f21799c2a63a272dafd3778aa9');
  assert.equal(program.checkpoint.archiveSha256, '309d607e9c7256d6ba464755e40142f0047f6b30c62187e630c6102c286ac7f3');
  assert.equal(program.checkpoint.sourceTreeSha256, '2b0c41d13c6c15aa941916d5e739fe8d5d9d26938b682fa2517162fed860c1f5');
  assert.equal(verifyCardanoPreprodInvariantEvidenceProgram(program, { expectedCheckpoint: CARDANO_PREPROD_CAPTURE_BASELINE }).valid, true);
});

test('Cardano Preprod invariant program requires every canonical invariant and lifecycle action', () => {
  const program = createCardanoPreprodInvariantEvidenceProgram({ checkpoint: CARDANO_PREPROD_CAPTURE_BASELINE });
  assert.deepEqual(program.requiredInvariantIds, CORE_INVARIANT_IDS);
  assert.deepEqual(program.requiredLifecycleActions, CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS);
  assert.deepEqual(program.requiredLifecycleActions, ['initialize', 'heartbeat', 'approve', 'execute']);
  assert.equal(program.requiredEvidenceLevel, 'public-testnet');
});

test('Cardano synchronized evaluation cannot authorize an OmegaVault support claim', () => {
  const program = createCardanoPreprodInvariantEvidenceProgram({ checkpoint: CARDANO_PREPROD_CAPTURE_BASELINE });
  assert.equal(program.synchronizedEvaluationIsSufficientForSupport, false);
  assert.equal(program.supportClaimAuthorized, false);
  assert.equal(program.publicNetworkRecoveryProven, false);
});

test('Cardano invariant program fails closed if requirements or authority are weakened', () => {
  const program = createCardanoPreprodInvariantEvidenceProgram({ checkpoint: CARDANO_PREPROD_CAPTURE_BASELINE });

  const missingInvariant = structuredClone(program);
  missingInvariant.requiredInvariantIds.pop();
  assert.equal(verifyCardanoPreprodInvariantEvidenceProgram(missingInvariant, { expectedCheckpoint: CARDANO_PREPROD_CAPTURE_BASELINE }).valid, false);

  const fewerActions = structuredClone(program);
  fewerActions.requiredLifecycleActions = ['execute'];
  assert.equal(verifyCardanoPreprodInvariantEvidenceProgram(fewerActions, { expectedCheckpoint: CARDANO_PREPROD_CAPTURE_BASELINE }).valid, false);

  const promoted = structuredClone(program);
  promoted.supportClaimAuthorized = true;
  assert.equal(verifyCardanoPreprodInvariantEvidenceProgram(promoted, { expectedCheckpoint: CARDANO_PREPROD_CAPTURE_BASELINE }).valid, false);
});
