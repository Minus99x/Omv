import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorAuditIndex } from '../src/chains/operator-audit-index.js';
import { createValidatedOperatorAuditIndexResponse } from '../src/api/response-contracts.js';
import { createOperatorAuditIndexUiModel } from '../public/operator-audit-index-ui.js';

test('browser review index consumes only backend-validated index', () => {
  const model = createOperatorAuditIndexUiModel(createValidatedOperatorAuditIndexResponse(createOperatorAuditIndex()));
  assert.equal(model.available, true);
  assert.equal(model.index.externalCheckpointIdentity, 'attached-after-archive-seal');
});

test('browser review index fails closed without backend validation', () => {
  const model = createOperatorAuditIndexUiModel({ schema:'omegavault.api.operator-audit-index.v1', data:createOperatorAuditIndex() });
  assert.equal(model.available, false);
});
