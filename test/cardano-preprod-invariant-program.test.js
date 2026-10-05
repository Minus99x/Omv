import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_INVARIANT_IDS } from '../src/core/invariants.js';
import {
  CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS,
  createCardanoPreprodInvariantEvidenceProgram,
  verifyCardanoPreprodInvariantEvidenceProgram
} from '../src/chains/cardano/preprod-invariant-program.js';
import { CARDANO_PREPROD_CAPTURE_BASELINE } from '../src/chains/cardano/preprod-capture-session.js';

test('Cardano Preprod invariant program binds the exact sealed 0.6.58 checkpoint', () => {
  const program = createCardanoPreprodInvariantEvidenceProgram({ checkpoint: CARDANO_PREPROD_CAPTURE_BASELINE });
  assert.deepEqual(program.checkpoint, CARDANO_PREPROD_CAPTURE_BASELINE);
  assert.equal(program.checkpoint.checkpointRef, '0.6.58-dev');
  assert.equal(program.checkpoint.sourceCommitSha, 'f3f67a62d66dc9a509c85d33eb35674133e08bb3');
  assert.equal(program.checkpoint.archiveSha256, '2e9129ed9d1eac5c61d85b625aebd7828988da8298c7b5914169769fde2bb463');
  assert.equal(program.checkpoint.sourceTreeSha256, '59d543758df1915d36b4f7b984425a37503468704c187c6ceb4ed3cfd763ff58');
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
