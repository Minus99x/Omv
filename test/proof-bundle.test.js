import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpointBoundProofBundle, verifyCheckpointBoundProofBundle } from '../src/core/proof-bundle.js';

const checkpoint = Object.freeze({
  ref: '0.6.30-dev',
  archive: 'omegavault-mvp-0.6.30-dev.zip',
  archiveSha256: 'ab'.repeat(32),
  dependencyLockSha256: 'cd'.repeat(32)
});

const proof = Object.freeze({
  kind: 'native-recovery',
  chainId: 'xdc',
  networkRef: 'xdc:apothem',
  proof: Object.freeze({ success: true, transactionRef: `0x${'11'.repeat(32)}`, sha256: 'ef'.repeat(32) })
});

test('proof bundle binds exact checkpoint archive, dependency lock and proof payload', () => {
  const bundle = createCheckpointBoundProofBundle({ checkpoint, proofs: [proof] });
  assert.equal(bundle.checkpoint.ref, '0.6.30-dev');
  assert.equal(bundle.checkpoint.archiveSha256, checkpoint.archiveSha256);
  assert.equal(bundle.checkpoint.dependencyLockSha256, checkpoint.dependencyLockSha256);
  assert.match(bundle.proofs[0].proofSha256, /^[0-9a-f]{64}$/);
  assert.match(bundle.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyCheckpointBoundProofBundle(bundle, { checkpoint, proofs: [proof] }), { ok: true, errors: [] });
});

test('proof bundle fails verification if archive identity changes', () => {
  const bundle = createCheckpointBoundProofBundle({ checkpoint, proofs: [proof] });
  const changed = { ...checkpoint, archiveSha256: '12'.repeat(32) };
  const result = verifyCheckpointBoundProofBundle(bundle, { checkpoint: changed, proofs: [proof] });
  assert.equal(result.ok, false);
});

test('proof bundle fails verification if a proof payload changes', () => {
  const bundle = createCheckpointBoundProofBundle({ checkpoint, proofs: [proof] });
  const changedProof = { ...proof, proof: { ...proof.proof, success: false } };
  const result = verifyCheckpointBoundProofBundle(bundle, { checkpoint, proofs: [changedProof] });
  assert.equal(result.ok, false);
});

test('proof bundle rejects duplicate chain/network/kind entries', () => {
  assert.throws(() => createCheckpointBoundProofBundle({ checkpoint, proofs: [proof, proof] }), /duplicate/);
});

test('proof bundle supports explicit parent-bundle lineage', () => {
  const bundle = createCheckpointBoundProofBundle({ checkpoint, proofs: [proof], parentBundleSha256: '34'.repeat(32) });
  assert.equal(bundle.parentBundleSha256, '34'.repeat(32));
  assert.equal(verifyCheckpointBoundProofBundle(bundle, { checkpoint, proofs: [proof] }).ok, true);
});
