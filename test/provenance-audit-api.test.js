import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvenanceIntegrityAudit } from '../src/chains/provenance-audit.js';
import { createEvidenceProvenanceCatalog } from '../src/chains/evidence-provenance.js';
import { createValidatedProvenanceIntegrityAuditResponse, validateProvenanceIntegrityAuditResponse, validateEvidenceProvenanceCatalogResponse } from '../src/api/response-contracts.js';

test('validated audit API accepts backend-generated audit', () => {
  const response = createValidatedProvenanceIntegrityAuditResponse(createProvenanceIntegrityAudit());
  assert.equal(response.schema, 'omegavault.api.provenance-integrity-audit.v1');
  assert.equal(response.validation.ok, true);
  assert.equal(response.validation.lineageStatus, 'not-recorded');
});

test('audit API rejects tampered audit state', () => {
  const audit = structuredClone(createProvenanceIntegrityAudit());
  audit.lineageRecovery.status = 'complete';
  assert.throws(() => validateProvenanceIntegrityAuditResponse(audit), /Invalid provenance-integrity audit/);
});

test('provenance API rejects malformed explicit parent bundle digest', () => {
  const catalog = structuredClone(createEvidenceProvenanceCatalog());
  catalog.records[0].parentBundleSha256 = 'not-a-digest';
  assert.throws(() => validateEvidenceProvenanceCatalogResponse(catalog), /Parent bundle SHA-256 is invalid/);
});
