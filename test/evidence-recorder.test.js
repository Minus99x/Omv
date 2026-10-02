import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEvidenceJson, createEvidenceRecord, evidenceDigest, validateEvidenceRecord } from '../src/core/evidence.js';

const CHECKPOINT_SHA = 'ab'.repeat(32);
const PARENT_SHA = 'cd'.repeat(32);

function makeRecord(overrides = {}) {
  return createEvidenceRecord({
    vaultId: 'vault-test',
    chainId: 'ethereum',
    networkRef: 'ethereum:sepolia',
    mechanism: 'evm-recovery-vault',
    actions: [{ operation: 'recovery.approved', txRef: '0x1' }],
    finalState: { recovered: true, balance: '0' },
    ...overrides
  }, new Date('2026-10-02T00:00:00Z'));
}

test('evidence record is digest-bound, deeply frozen and validates', () => {
  const record = makeRecord();
  assert.equal(record.format, 'OmegaVault-evidence/0.6');
  assert.match(record.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateEvidenceRecord(record), { ok: true, errors: [] });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.actions), true);
  assert.equal(Object.isFrozen(record.actions[0]), true);
});

test('tampering causes evidence digest validation failure', () => {
  const record = makeRecord();
  const tampered = structuredClone(record);
  tampered.finalState.recovered = false;
  assert.equal(validateEvidenceRecord(tampered).ok, false);
});

test('canonical evidence hashing is key-order stable and supports BigInt without ambiguity', () => {
  const left = { z: 1, a: { y: 2n, x: 'ok' } };
  const right = { a: { x: 'ok', y: 2n }, z: 1 };
  assert.equal(canonicalEvidenceJson(left), canonicalEvidenceJson(right));
  assert.equal(evidenceDigest(left), evidenceDigest(right));
  assert.match(canonicalEvidenceJson(left), /\$bigint/);
});

test('evidence creation fails closed on values JSON would otherwise drop or blur', () => {
  assert.throws(() => makeRecord({ finalState: { recovered: true, hidden: undefined } }), /unsupported evidence data/);
  assert.throws(() => makeRecord({ finalState: { recovered: true, bad: Number.NaN } }), /non-finite/);
  assert.throws(() => makeRecord({ finalState: { recovered: true, when: new Date() } }), /plain evidence objects/);
  assert.throws(() => makeRecord({ actions: [{ operation: 'x', callback() {} }] }), /unsupported evidence data/);
});

test('evidence creation fails closed on cyclic evidence structures', () => {
  const state = { recovered: true };
  state.self = state;
  assert.throws(() => makeRecord({ finalState: state }), /cyclic evidence structure/);
});

test('lineage binds a record to both parent evidence and an exact project checkpoint', () => {
  const bound = makeRecord({
    parentEvidenceSha256: PARENT_SHA,
    checkpoint: { ref: '0.6.26-dev', sha256: CHECKPOINT_SHA }
  });
  const unbound = makeRecord();
  assert.equal(bound.lineage.parentEvidenceSha256, PARENT_SHA);
  assert.equal(bound.lineage.checkpoint.ref, '0.6.26-dev');
  assert.equal(bound.lineage.checkpoint.sha256, CHECKPOINT_SHA);
  assert.notEqual(bound.sha256, unbound.sha256);
  assert.equal(validateEvidenceRecord(bound).ok, true);
});

test('lineage rejects malformed or half-specified checkpoint bindings', () => {
  assert.throws(() => makeRecord({ parentEvidenceSha256: 'bad' }), /parentEvidenceSha256/);
  assert.throws(() => makeRecord({ checkpoint: { ref: '0.6.26-dev' } }), /checkpoint.sha256/);
  assert.throws(() => makeRecord({ checkpoint: { sha256: CHECKPOINT_SHA } }), /checkpoint.ref/);
});

test('validator reports canonicalization failure instead of throwing on malformed external evidence', () => {
  const record = structuredClone(makeRecord());
  record.finalState.bad = undefined;
  const result = validateEvidenceRecord(record);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('canonicalization failed')));
});
