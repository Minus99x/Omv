import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_PROVENANCE_RECORDS } from '../src/chains/evidence-provenance.js';
import { createProvenanceIntegrityAudit, verifyProvenanceIntegrityAudit } from '../src/chains/provenance-audit.js';

test('provenance audit is deterministic and self-verifying', () => {
  const first = createProvenanceIntegrityAudit();
  const second = createProvenanceIntegrityAudit();
  assert.deepEqual(first, second);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyProvenanceIntegrityAudit(first), { ok: true, errors: [] });
});

test('lineage recovery reports no recovered parent bundle when existing evidence records none', () => {
  const audit = createProvenanceIntegrityAudit();
  assert.equal(audit.lineageRecovery.status, 'not-recorded');
  assert.equal(audit.lineageRecovery.recoveredBindingCount, 0);
  assert.equal(audit.lineageRecovery.unrecordedRefCount, EVIDENCE_PROVENANCE_RECORDS.length);
  assert.deepEqual(audit.lineageRecovery.recovered, []);
  assert.ok(audit.lineageRecovery.unrecordedRefs.includes('0.6.30:PROOF_PROVENANCE_RESUME'));
});

test('every provenance record explicitly distinguishes missing parent lineage with null', () => {
  assert.ok(EVIDENCE_PROVENANCE_RECORDS.every(record => Object.hasOwn(record, 'parentBundleSha256')));
  assert.ok(EVIDENCE_PROVENANCE_RECORDS.every(record => record.parentBundleSha256 === null));
});

test('tampered audit digest fails closed', () => {
  const audit = structuredClone(createProvenanceIntegrityAudit());
  audit.integrity.provenanceErrorCount += 1;
  const result = verifyProvenanceIntegrityAudit(audit);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /digest mismatch/i.test(error)));
});
