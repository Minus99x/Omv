import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalReviewBasis, verifyExternalReviewBasis } from '../src/chains/review-basis.js';

test('external review basis is deterministic and binds audit/history/provenance state', () => {
  const first = createExternalReviewBasis();
  const second = createExternalReviewBasis();
  assert.deepEqual(first, second);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
  assert.match(first.provenanceAudit.sha256, /^[0-9a-f]{64}$/);
  assert.match(first.evidenceHistory.sha256, /^[0-9a-f]{64}$/);
  assert.match(first.evidenceProvenance.sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.semantics.externalCheckpointIdentity, 'checkpoint-sidecar-only');
  assert.deepEqual(verifyExternalReviewBasis(first), { ok: true, errors: [] });
});

test('external review basis rejects stale or tampered audit/history state', () => {
  const basis = structuredClone(createExternalReviewBasis());
  basis.evidenceHistory.sha256 = 'aa'.repeat(32);
  const result = verifyExternalReviewBasis(basis);
  assert.equal(result.ok, false);
});
