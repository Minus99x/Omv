import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evidenceDigest } from '../src/core/evidence.js';
import { createExternalReviewBasis, verifyExternalReviewBasis } from '../src/chains/review-basis.js';

test('static 0.6.40 review-basis artifacts remain immutable historical snapshots', () => {
  const urls = [
    new URL('../artifacts/review/omegavault-external-review-basis-0.6.40.json', import.meta.url),
    new URL('../docs/evidence/EXTERNAL_REVIEW_BASIS_0.6.40.json', import.meta.url)
  ];
  const [artifactCopy, documentationCopy] = urls.map(url => JSON.parse(fs.readFileSync(url, 'utf8')));

  assert.deepEqual(artifactCopy, documentationCopy);
  assert.equal(artifactCopy.sha256, 'a689cd62cd8fff2b04ac05154701a11ac9d745758a8b73c607eae7af7ff0344b');

  const { sha256, ...unsigned } = artifactCopy;
  assert.equal(evidenceDigest(unsigned), sha256);

  const current = createExternalReviewBasis();
  assert.notEqual(current.sha256, artifactCopy.sha256);

  const verification = verifyExternalReviewBasis(artifactCopy);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.includes('Review basis does not match current backend evidence state.'));
});
