import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSourceTreeInventory, createCheckpointManifest } from '../src/core/checkpoint-manifest.js';
import { verifyPackageLockIntegrity } from '../src/core/dependency-integrity.js';
import { createExternalReviewBasis } from '../src/chains/review-basis.js';
import { createExternalReviewIndex, verifyExternalReviewIndex } from '../src/core/external-review-index.js';

function fixture() {
  const packageJsonText = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const packageLockText = readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8');
  const dependency = verifyPackageLockIntegrity({ packageJsonText, packageLockText });
  assert.equal(dependency.ok, true);
  const sourceInventory = createSourceTreeInventory(new URL('..', import.meta.url).pathname);
  const checkpointManifest = createCheckpointManifest({
    checkpoint: { ref: '0.6.40-dev', archive: 'omegavault-mvp-0.6.40-dev.zip', archiveSha256: '11'.repeat(32) },
    dependencyLock: dependency.binding,
    sourceInventory
  });
  return {
    checkpointManifest: Object.freeze({ ...checkpointManifest, sourceInventory }),
    checkpointManifestFilename: 'omegavault-mvp-0.6.40-dev.checkpoint-manifest.json',
    checkpointManifestFileSha256: createHash('sha256').update('sidecar-bytes').digest('hex'),
    reviewBasis: createExternalReviewBasis()
  };
}

test('external review index binds checkpoint sidecar to current review basis', () => {
  const inputs = fixture();
  const index = createExternalReviewIndex(inputs);
  assert.equal(index.schema, 'omegavault.external-review-index.v1');
  assert.equal(index.checkpoint.ref, '0.6.40-dev');
  assert.equal(index.reviewBasis.provenanceAuditSha256, inputs.reviewBasis.provenanceAudit.sha256);
  assert.equal(index.reviewBasis.evidenceHistorySha256, inputs.reviewBasis.evidenceHistory.sha256);
  assert.equal(index.verification.selfReferentialArchiveHashing, false);
  assert.deepEqual(verifyExternalReviewIndex(index, inputs), { ok: true, errors: [] });
});

test('external review index rejects swapped checkpoint-sidecar bytes', () => {
  const inputs = fixture();
  const index = createExternalReviewIndex(inputs);
  const result = verifyExternalReviewIndex(index, { ...inputs, checkpointManifestFileSha256: '22'.repeat(32) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /digest mismatch|identity mismatch/i.test(error)));
});

test('external review index rejects tampered checkpoint manifest', () => {
  const inputs = fixture();
  const index = createExternalReviewIndex(inputs);
  const changed = structuredClone(inputs.checkpointManifest);
  changed.checkpoint.archiveSha256 = '33'.repeat(32);
  const result = verifyExternalReviewIndex(index, { ...inputs, checkpointManifest: changed });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /Checkpoint manifest is invalid/i.test(error)));
});

test('external review index rejects stale review basis', () => {
  const inputs = fixture();
  const index = createExternalReviewIndex(inputs);
  const stale = structuredClone(inputs.reviewBasis);
  stale.provenanceAudit.sha256 = '44'.repeat(32);
  const result = verifyExternalReviewIndex(index, { ...inputs, reviewBasis: stale });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /review basis is invalid/i.test(error)));
});

test('tampered external review index digest fails closed', () => {
  const inputs = fixture();
  const index = structuredClone(createExternalReviewIndex(inputs));
  index.checkpoint.archiveSha256 = '55'.repeat(32);
  const result = verifyExternalReviewIndex(index, inputs);
  assert.equal(result.ok, false);
});
