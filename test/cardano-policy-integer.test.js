import test from 'node:test';
import assert from 'node:assert/strict';
import { cardanoPositiveSafeInteger } from '../src/chains/cardano/policy-integer.js';

test('Cardano policy integers accept safe numbers and canonical decimal strings', () => {
  assert.equal(cardanoPositiveSafeInteger(2, 'threshold'), 2);
  assert.equal(cardanoPositiveSafeInteger('60000', 'inactivityMs'), 60000);
  assert.equal(cardanoPositiveSafeInteger(2n, 'threshold'), 2);
});

test('Cardano policy integers reject coercion, noncanonical numbers, and unsafe bounds', () => {
  for (const value of [
    true, false, null, undefined, [], {}, '0x2', '2e0', ' 2', '02', '2.0',
    0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    BigInt(Number.MAX_SAFE_INTEGER) + 1n
  ]) {
    assert.throws(
      () => cardanoPositiveSafeInteger(value, 'policy integer'),
      /must be a positive safe integer/
    );
  }
});
