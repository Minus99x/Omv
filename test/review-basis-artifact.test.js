import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createExternalReviewBasis } from '../src/chains/review-basis.js';

test('static 0.6.40 review-basis artifacts match current backend state', () => {
  const expected = createExternalReviewBasis();
  for (const url of [
    new URL('../artifacts/review/omegavault-external-review-basis-0.6.40.json', import.meta.url),
    new URL('../docs/evidence/EXTERNAL_REVIEW_BASIS_0.6.40.json', import.meta.url)
  ]) {
    const actual = JSON.parse(fs.readFileSync(url, 'utf8'));
    assert.deepEqual(actual, expected);
  }
});
