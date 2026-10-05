import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_INVARIANT_IDS } from '../src/core/invariants.js';
import {
  CARDANO_PREPROD_REQUIRED_LIFECYCLE_ACTIONS,
  createCardanoPreprodInvariantEvidenceProgram,
  verifyCardanoPreprodInvariantEvidenceProgram
} from '../src/chains/cardano/preprod-invariant-program.js';
import { CARDANO_PREPROD_CAPTURE_BASELINE } from '../src/chains/cardano/preprod-capture-session.js';

test('Cardano Preprod invariant program binds the exact sealed 0.6.56 checkpoint', () => {
  const program = createCardanoPreprodInvariantEvidenceProgram({ checkpoint: CARDANO_PREPROD_CAPTURE_BASELINE });
  assert.deepEqual(program.checkpoint, CARDANO_PREPROD_CAPTURE_BASELINE);
  assert.equal(program.checkpoint.checkpointRef, '0.6.56-dev');
  assert.equal(program.checkpoint.sourceCommitSha, 'a14e7e4061dbe0b32399b8188d98d9851321ee14');
  assert.equal(program.checkpoint.archiveSha256, '6c2ba7e857be0cbe2f5a2dd40c23c11fe432351ca3dbacbdc7107ff86715cb87');
  assert.equal(program.checkpoint.sourceTreeSha256, '8081a98574e11e98a65d84bc87f636aec60d16960fbc35aab7e791abb13c082a');
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
