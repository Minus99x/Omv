import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorAuditIndex } from '../src/chains/operator-audit-index.js';
import { createValidatedOperatorAuditIndexResponse, validateOperatorAuditIndexResponse } from '../src/api/response-contracts.js';

test('validated operator audit-index API accepts backend-generated index', () => {
  const response = createValidatedOperatorAuditIndexResponse(createOperatorAuditIndex());
  assert.equal(response.schema, 'omegavault.api.operator-audit-index.v1');
  assert.equal(response.validation.ok, true);
});

test('operator audit-index API rejects checkpoint drift', () => {
  const index = structuredClone(createOperatorAuditIndex());
  index.checkpointRef = '0.6.99-dev';
  assert.throws(() => validateOperatorAuditIndexResponse(index), /checkpoint/i);
});

test('operator audit-index API rejects forged evidence-history digest', () => {
  const index = structuredClone(createOperatorAuditIndex());
  index.evidenceHistorySha256 = 'ab'.repeat(32);
  assert.throws(() => validateOperatorAuditIndexResponse(index), /Invalid operator audit index/);
});
