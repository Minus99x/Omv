import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceRecord, validateEvidenceRecord } from '../src/core/evidence.js';

test('evidence record is digest-bound and validates', () => {
  const record = createEvidenceRecord({
    vaultId: 'vault-test', chainId: 'ethereum', networkRef: '0xaa36a7',
    mechanism: 'evm-recovery-vault',
    actions: [{ operation: 'recovery.approved', txRef: '0x1' }],
    finalState: { recovered: true, balance: '0' }
  }, new Date('2026-09-28T00:00:00Z'));
  assert.match(record.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateEvidenceRecord(record), { ok: true, errors: [] });
});

test('tampering causes evidence digest validation failure', () => {
  const record = createEvidenceRecord({
    vaultId: 'vault-test', chainId: 'ethereum', networkRef: '0xaa36a7', actions: [], finalState: { recovered: true }
  });
  const tampered = structuredClone(record);
  tampered.finalState.recovered = false;
  assert.equal(validateEvidenceRecord(tampered).ok, false);
});
