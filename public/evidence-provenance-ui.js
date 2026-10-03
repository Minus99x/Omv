const API_SCHEMA = 'omegavault.api.evidence-provenance.v1';
const CATALOG_SCHEMA = 'omegavault.evidence-provenance-catalog.v1';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function textArray(value) {
  if (!Array.isArray(value) || value.some(item => !text(item))) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value];
}

function view(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const ref = text(item.ref);
  const checkpointRef = text(item.checkpointRef);
  const archiveFilename = text(item.archiveFilename);
  const archiveSha256 = text(item.archiveSha256);
  const parentBundleSha256 = item.parentBundleSha256 == null ? null : text(item.parentBundleSha256);
  const scope = text(item.scope);
  const summary = text(item.summary);
  const chainIds = textArray(item.chainIds);
  const artifactPaths = textArray(item.artifactPaths);
  if (!ref || !checkpointRef || !archiveFilename || !archiveSha256 || !scope || !summary || !chainIds || !artifactPaths) return null;
  if (item.parentBundleSha256 != null && (!parentBundleSha256 || !/^[0-9a-f]{64}$/i.test(parentBundleSha256))) return null;
  if (!/^0\.6\.\d+:[A-Z0-9_]+$/.test(ref) || !/^[0-9a-f]{64}$/i.test(archiveSha256)) return null;
  return Object.freeze({ ref, checkpointRef, archiveFilename, archiveSha256: archiveSha256.toLowerCase(), parentBundleSha256: parentBundleSha256?.toLowerCase() ?? null, scope, summary, chainIds: Object.freeze(chainIds), artifactPaths: Object.freeze(artifactPaths) });
}

export function createEvidenceProvenanceUiModel(envelope) {
  const unavailable = reason => Object.freeze({
    schema: 'omegavault.evidence-provenance-ui-model.v1',
    available: false,
    reason,
    records: Object.freeze([]),
    byRef: Object.freeze({})
  });
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return unavailable('Evidence provenance response is missing.');
  if (envelope.schema !== API_SCHEMA) return unavailable('Evidence provenance API schema is not recognized.');
  if (envelope.validation?.ok !== true) return unavailable('Evidence provenance response was not backend-validated.');
  if (envelope.data?.schema !== CATALOG_SCHEMA || !Array.isArray(envelope.data.records)) return unavailable('Evidence provenance catalog is malformed.');
  const records = [];
  const byRef = {};
  for (const item of envelope.data.records) {
    const record = view(item);
    if (!record) return unavailable('One or more evidence provenance records are malformed.');
    if (byRef[record.ref]) return unavailable('Evidence provenance catalog contains duplicate refs.');
    byRef[record.ref] = record;
    records.push(record);
  }
  return Object.freeze({
    schema: 'omegavault.evidence-provenance-ui-model.v1',
    available: true,
    reason: null,
    records: Object.freeze(records),
    byRef: Object.freeze(byRef)
  });
}

export function resolveEvidenceReference(model, ref, chainId) {
  if (!model?.available || !model.byRef || typeof ref !== 'string') return null;
  const record = model.byRef[ref] ?? null;
  if (!record || !record.chainIds.includes(chainId)) return null;
  return record;
}