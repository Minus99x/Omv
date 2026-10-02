const API_SCHEMA = 'omegavault.api.evidence-history.v1';
const CATALOG_SCHEMA = 'omegavault.evidence-history-catalog.v1';
const RELATION = 'evidence-checkpoint-order-not-source-ancestry';

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function textArray(value) {
  if (!Array.isArray(value) || value.some(item => !text(item))) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value];
}

function checkpointView(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const checkpointRef = text(item.checkpointRef), archiveFilename = text(item.archiveFilename), archiveSha256 = text(item.archiveSha256), relationSemantics = text(item.relationSemantics);
  const evidenceRefs = textArray(item.evidenceRefs), chainIds = textArray(item.chainIds), scopes = textArray(item.scopes), artifactPaths = textArray(item.artifactPaths), summaries = textArray(item.summaries);
  if (!checkpointRef || !archiveFilename || !archiveSha256 || !evidenceRefs || !chainIds || !scopes || !artifactPaths || !summaries) return null;
  if (!/^0\.6\.\d+-dev$/.test(checkpointRef) || !/^[0-9a-f]{64}$/i.test(archiveSha256) || relationSemantics !== RELATION) return null;
  if (!Number.isInteger(item.versionNumber) || item.versionNumber < 0) return null;
  const previous = item.previousEvidenceCheckpointRef == null ? null : text(item.previousEvidenceCheckpointRef);
  const next = item.nextEvidenceCheckpointRef == null ? null : text(item.nextEvidenceCheckpointRef);
  if (item.previousEvidenceCheckpointRef != null && !previous) return null;
  if (item.nextEvidenceCheckpointRef != null && !next) return null;
  return Object.freeze({ checkpointRef, versionNumber:item.versionNumber, archiveFilename, archiveSha256:archiveSha256.toLowerCase(), evidenceRefs:Object.freeze(evidenceRefs), chainIds:Object.freeze(chainIds), scopes:Object.freeze(scopes), artifactPaths:Object.freeze(artifactPaths), summaries:Object.freeze(summaries), previousEvidenceCheckpointRef:previous, nextEvidenceCheckpointRef:next, relationSemantics });
}

export function createEvidenceHistoryUiModel(envelope) {
  const unavailable = reason => Object.freeze({schema:'omegavault.evidence-history-ui-model.v1',available:false,reason,summary:null,checkpoints:Object.freeze([])});
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return unavailable('Evidence history response is missing.');
  if (envelope.schema !== API_SCHEMA) return unavailable('Evidence history API schema is not recognized.');
  if (envelope.validation?.ok !== true) return unavailable('Evidence history response was not backend-validated.');
  if (envelope.data?.schema !== CATALOG_SCHEMA || envelope.data.relationSemantics !== RELATION || !Array.isArray(envelope.data.checkpoints)) return unavailable('Evidence history catalog is malformed.');
  const checkpoints=[];
  for (const item of envelope.data.checkpoints) { const view=checkpointView(item); if(!view) return unavailable('One or more evidence history checkpoints are malformed.'); checkpoints.push(view); }
  if (!checkpoints.length || new Set(checkpoints.map(i=>i.checkpointRef)).size !== checkpoints.length) return unavailable('Evidence history checkpoint set is empty or duplicated.');
  const summary=envelope.data.summary;
  if (!summary || summary.checkpointCount!==checkpoints.length) return unavailable('Evidence history summary does not match checkpoint data.');
  return Object.freeze({schema:'omegavault.evidence-history-ui-model.v1',available:true,reason:null,summary:Object.freeze({...summary}),checkpoints:Object.freeze(checkpoints)});
}

export function selectEvidenceHistory(model,{query='',chainId='all',sort='newest'}={}) {
  if (!model?.available || !Array.isArray(model.checkpoints)) return Object.freeze([]);
  if (!['newest','oldest'].includes(sort)) throw new TypeError(`Unknown evidence history sort: ${sort}`);
  if (typeof query !== 'string' || typeof chainId !== 'string') throw new TypeError('Evidence history query and chain filter must be strings.');
  const needle=query.trim().toLowerCase();
  let rows=[...model.checkpoints];
  if (chainId!=='all') rows=rows.filter(row=>row.chainIds.includes(chainId));
  if (needle) rows=rows.filter(row=>[
    row.checkpointRef,row.archiveFilename,row.archiveSha256,...row.evidenceRefs,...row.chainIds,...row.scopes,...row.artifactPaths,...row.summaries
  ].some(value=>String(value).toLowerCase().includes(needle)));
  rows.sort((a,b)=>sort==='newest'?b.versionNumber-a.versionNumber:a.versionNumber-b.versionNumber);
  return Object.freeze(rows);
}
