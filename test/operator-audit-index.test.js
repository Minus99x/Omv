import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorAuditIndex, verifyOperatorAuditIndex, createExternalReviewIndex, verifyExternalReviewIndex, CURRENT_AUDIT_INDEX_CHECKPOINT } from '../src/chains/operator-audit-index.js';

test('operator audit index deterministically binds current provenance audit and evidence history', () => {
  const first = createOperatorAuditIndex();
  const second = createOperatorAuditIndex();
  assert.deepEqual(first, second);
  assert.equal(first.checkpointRef, CURRENT_AUDIT_INDEX_CHECKPOINT);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
  assert.match(first.provenanceAuditSha256, /^[0-9a-f]{64}$/);
  assert.match(first.evidenceHistorySha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyOperatorAuditIndex(first), { ok: true, errors: [] });
});

test('operator audit index fails closed when the provenance-audit binding is forged', () => {
  const index = structuredClone(createOperatorAuditIndex());
  index.provenanceAuditSha256 = '11'.repeat(32);
  assert.equal(verifyOperatorAuditIndex(index).ok, false);
});

test('operator audit index explicitly defers archive and sidecar identity until seal', () => {
  assert.equal(createOperatorAuditIndex().externalCheckpointIdentity, 'attached-after-archive-seal');
});

test('external review index binds sealed archive/sidecar identity without embedding self-hash semantics', () => {
  const operatorAuditIndex = createOperatorAuditIndex();
  const checkpointIdentity = {
    checkpointRef: CURRENT_AUDIT_INDEX_CHECKPOINT,
    archiveFilename: 'omegavault-mvp-0.6.40-dev.zip',
    archiveSha256: '11'.repeat(32),
    sidecarFilename: 'omegavault-mvp-0.6.40-dev.checkpoint-manifest.json',
    sidecarFileSha256: '22'.repeat(32),
    checkpointManifestSha256: '33'.repeat(32),
    sourceTreeSha256: '44'.repeat(32),
    dependencyLockSha256: '55'.repeat(32)
  };
  const index = createExternalReviewIndex({ operatorAuditIndex, checkpointIdentity });
  assert.equal(index.verificationSemantics.archiveSelfHashEmbedded, false);
  assert.equal(index.checkpointIdentity.archiveSha256, checkpointIdentity.archiveSha256);
  assert.deepEqual(verifyExternalReviewIndex(index, { operatorAuditIndex, checkpointIdentity }), { ok: true, errors: [] });
});

test('external review index rejects checkpoint identity drift', () => {
  const operatorAuditIndex = createOperatorAuditIndex();
  assert.throws(() => createExternalReviewIndex({ operatorAuditIndex, checkpointIdentity: {
    checkpointRef: '0.6.41-dev', archiveFilename: 'omegavault-mvp-0.6.41-dev.zip', archiveSha256:'11'.repeat(32),
    sidecarFilename:'omegavault-mvp-0.6.41-dev.checkpoint-manifest.json', sidecarFileSha256:'22'.repeat(32),
    checkpointManifestSha256:'33'.repeat(32), sourceTreeSha256:'44'.repeat(32), dependencyLockSha256:'55'.repeat(32)
  }}), /invalid|different checkpoints/i);
});
