import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMOTION_GATES, createMaturityRecord, canPromoteToLiveProof, missingPromotionGates } from '../src/chains/maturity.js';

test('connector cannot be promoted while any required proof gate is missing', () => {
  const record = createMaturityRecord({ chainId: 'stellar', gates: { 'network-profile': true } });
  assert.equal(canPromoteToLiveProof(record), false);
  assert.ok(missingPromotionGates(record).includes('evidence-export'));
});

test('promotion becomes possible only when every gate is true', () => {
  const gates = Object.fromEntries(PROMOTION_GATES.map(gate => [gate, true]));
  const record = createMaturityRecord({ chainId: 'example', gates });
  assert.equal(record.completed, PROMOTION_GATES.length);
  assert.equal(canPromoteToLiveProof(record), true);
});
