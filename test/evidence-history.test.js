import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceHistoryCatalog } from '../src/chains/evidence-history.js';
import { EVIDENCE_PROVENANCE_RECORDS } from '../src/chains/evidence-provenance.js';

test('history groups provenance records by checkpoint with consistent archive identity', () => {
  const history = createEvidenceHistoryCatalog();
  assert.equal(history.schema, 'omegavault.evidence-history-catalog.v1');
  assert.ok(history.checkpoints.length >= 1);
  for (const item of history.checkpoints) {
    assert.match(item.checkpointRef, /^0\.6\.\d+-dev$/);
    assert.match(item.archiveSha256, /^[0-9a-f]{64}$/);
    assert.ok(item.evidenceRefs.length >= 1);
    assert.ok(item.chainIds.length >= 1);
  }
});
test('history timeline is ordered and explicitly not source ancestry', () => {
  const history = createEvidenceHistoryCatalog();
  const versions = history.checkpoints.map(item => item.versionNumber);
  assert.deepEqual(versions, [...versions].sort((a,b)=>a-b));
  assert.equal(history.relationSemantics, 'evidence-checkpoint-order-not-source-ancestry');
  for (const item of history.checkpoints) assert.equal(item.relationSemantics, history.relationSemantics);
});
test('history links predecessor and successor checkpoints deterministically', () => {
  const history = createEvidenceHistoryCatalog();
  history.checkpoints.forEach((item, index) => {
    assert.equal(item.previousEvidenceCheckpointRef, index ? history.checkpoints[index-1].checkpointRef : null);
    assert.equal(item.nextEvidenceCheckpointRef, index < history.checkpoints.length-1 ? history.checkpoints[index+1].checkpointRef : null);
  });
});
test('history summary counts match provenance records', () => {
  const history = createEvidenceHistoryCatalog();
  assert.equal(history.summary.checkpointCount, history.checkpoints.length);
  assert.equal(history.summary.evidenceRefCount, EVIDENCE_PROVENANCE_RECORDS.length);
});
test('history rejects inconsistent archive identity inside one checkpoint', () => {
  const base = structuredClone(EVIDENCE_PROVENANCE_RECORDS[6]);
  const drift = { ...structuredClone(EVIDENCE_PROVENANCE_RECORDS[7]), archiveSha256: 'aa'.repeat(32) };
  assert.equal(base.checkpointRef, drift.checkpointRef);
  assert.throws(() => createEvidenceHistoryCatalog([base, drift]), /inconsistent archive provenance/);
});
