import { EVIDENCE_PROVENANCE_RECORDS } from './evidence-provenance.js';

const VERSION = /^0\.6\.(\d+)-dev$/;

function versionNumber(checkpointRef) {
  const match = String(checkpointRef).match(VERSION);
  if (!match) throw new TypeError(`Invalid evidence-history checkpoint ref: ${checkpointRef}`);
  return Number(match[1]);
}

function uniqueSorted(values) {
  return Object.freeze([...new Set(values)].sort((a, b) => a.localeCompare(b)));
}

function buildCheckpointEntries(records) {
  const grouped = new Map();
  for (const record of records) {
    const existing = grouped.get(record.checkpointRef);
    if (existing && (existing.archiveFilename !== record.archiveFilename || existing.archiveSha256 !== record.archiveSha256)) {
      throw new Error(`Checkpoint ${record.checkpointRef} has inconsistent archive provenance.`);
    }
    const group = existing ?? {
      checkpointRef: record.checkpointRef,
      versionNumber: versionNumber(record.checkpointRef),
      archiveFilename: record.archiveFilename,
      archiveSha256: record.archiveSha256,
      refs: [], chainIds: [], scopes: [], artifactPaths: [], summaries: []
    };
    group.refs.push(record.ref);
    group.chainIds.push(...record.chainIds);
    group.scopes.push(record.scope);
    group.artifactPaths.push(...record.artifactPaths);
    group.summaries.push(record.summary);
    grouped.set(record.checkpointRef, group);
  }

  const entries = [...grouped.values()].sort((a, b) => a.versionNumber - b.versionNumber || a.checkpointRef.localeCompare(b.checkpointRef));
  return Object.freeze(entries.map((group, index) => Object.freeze({
    checkpointRef: group.checkpointRef,
    versionNumber: group.versionNumber,
    archiveFilename: group.archiveFilename,
    archiveSha256: group.archiveSha256,
    evidenceRefs: uniqueSorted(group.refs),
    chainIds: uniqueSorted(group.chainIds),
    scopes: uniqueSorted(group.scopes),
    artifactPaths: uniqueSorted(group.artifactPaths),
    summaries: Object.freeze([...group.summaries]),
    previousEvidenceCheckpointRef: index > 0 ? entries[index - 1].checkpointRef : null,
    nextEvidenceCheckpointRef: index < entries.length - 1 ? entries[index + 1].checkpointRef : null,
    relationSemantics: 'evidence-checkpoint-order-not-source-ancestry'
  })));
}

export function createEvidenceHistoryCatalog(records = EVIDENCE_PROVENANCE_RECORDS) {
  if (!Array.isArray(records) || records.length < 1) throw new TypeError('Evidence history requires at least one provenance record.');
  const checkpoints = buildCheckpointEntries(records);
  const chainIds = uniqueSorted(checkpoints.flatMap(item => item.chainIds));
  return Object.freeze({
    schema: 'omegavault.evidence-history-catalog.v1',
    relationSemantics: 'evidence-checkpoint-order-not-source-ancestry',
    summary: Object.freeze({
      checkpointCount: checkpoints.length,
      evidenceRefCount: records.length,
      chainCount: chainIds.length,
      chainIds,
      earliestCheckpointRef: checkpoints[0].checkpointRef,
      latestCheckpointRef: checkpoints.at(-1).checkpointRef
    }),
    checkpoints
  });
}
