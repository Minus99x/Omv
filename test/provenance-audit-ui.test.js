import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvenanceIntegrityAudit } from '../src/chains/provenance-audit.js';
import { createValidatedProvenanceIntegrityAuditResponse } from '../src/api/response-contracts.js';
import { createProvenanceAuditUiModel, serializeValidatedProvenanceAudit } from '../public/provenance-audit-ui.js';

const model = () => createProvenanceAuditUiModel(createValidatedProvenanceIntegrityAuditResponse(createProvenanceIntegrityAudit()));

test('browser audit consumes only backend-validated audit', () => {
  const result = model();
  assert.equal(result.available, true);
  assert.equal(result.audit.lineageRecovery.status, 'not-recorded');
});

test('browser audit fails closed without backend validation', () => {
  const result = createProvenanceAuditUiModel({ schema: 'omegavault.api.provenance-integrity-audit.v1', data: createProvenanceIntegrityAudit() });
  assert.equal(result.available, false);
});

test('audit export serializes only validated backend audit', () => {
  const text = serializeValidatedProvenanceAudit(model());
  const parsed = JSON.parse(text);
  assert.equal(parsed.schema, 'omegavault.provenance-integrity-audit.v1');
  assert.equal(parsed.lineageRecovery.recoveredBindingCount, 0);
});

test('audit export refuses unavailable model', () => {
  assert.throws(() => serializeValidatedProvenanceAudit(createProvenanceAuditUiModel(null)), /backend-validated provenance audit/);
});
