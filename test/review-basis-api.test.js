import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalReviewBasis } from '../src/chains/review-basis.js';
import { createValidatedExternalReviewBasisResponse, validateExternalReviewBasisResponse } from '../src/api/response-contracts.js';

test('validated review-basis API accepts current backend state', () => {
  const response = createValidatedExternalReviewBasisResponse(createExternalReviewBasis());
  assert.equal(response.schema, 'omegavault.api.external-review-basis.v1');
  assert.equal(response.validation.ok, true);
  assert.equal(response.data.semantics.externalCheckpointIdentity, 'checkpoint-sidecar-only');
});

test('review-basis API rejects tampered history digest', () => {
  const basis = structuredClone(createExternalReviewBasis());
  basis.evidenceHistory.sha256 = '66'.repeat(32);
  assert.throws(() => validateExternalReviewBasisResponse(basis), /Invalid external review basis/);
});
