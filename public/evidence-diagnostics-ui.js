const API_SCHEMA='omegavault.api.evidence-diagnostics.v1';
const CATALOG_SCHEMA='omegavault.evidence-diagnostics-catalog.v1';
const LINEAGE='cryptographic-parent-bindings-only';
function text(v){return typeof v==='string'&&v.trim()?v.trim():null;}
function textArray(v){if(!Array.isArray(v)||v.some(x=>!text(x))||new Set(v).size!==v.length)return null;return [...v];}
function view(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  const chainId=text(item.chainId),name=text(item.name),severity=text(item.severity);
  const unresolved=textArray(item.unresolvedEvidenceRefs),crossWired=textArray(item.crossWiredEvidenceRefs),missing=textArray(item.missingGates),insufficient=textArray(item.insufficientEvidenceGates),blockers=textArray(item.blockers);
  const lineage=item.explicitLineage;
  if(!chainId||!name||!['error','gaps-present','clear'].includes(severity)||!unresolved||!crossWired||!missing||!insufficient||!blockers)return null;
  if(typeof item.promotionEligible!=='boolean'||typeof item.provenanceHealthy!=='boolean'||!Number.isInteger(item.evidenceRefCount)||!Number.isInteger(item.resolvedEvidenceRefCount))return null;
  if(!lineage||lineage.semantics!==LINEAGE||!['complete','partial','not-recorded'].includes(lineage.status)||!Number.isInteger(lineage.recordedRefCount)||!textArray(lineage.refs)||!text(lineage.note))return null;
  return Object.freeze({chainId,name,severity,promotionEligible:item.promotionEligible,provenanceHealthy:item.provenanceHealthy,evidenceRefCount:item.evidenceRefCount,resolvedEvidenceRefCount:item.resolvedEvidenceRefCount,unresolvedEvidenceRefs:Object.freeze(unresolved),crossWiredEvidenceRefs:Object.freeze(crossWired),missingGates:Object.freeze(missing),insufficientEvidenceGates:Object.freeze(insufficient),blockers:Object.freeze(blockers),explicitLineage:Object.freeze({status:lineage.status,semantics:lineage.semantics,recordedRefCount:lineage.recordedRefCount,refs:Object.freeze([...lineage.refs]),note:lineage.note})});
}
export function createEvidenceDiagnosticsUiModel(envelope){
 const unavailable=reason=>Object.freeze({schema:'omegavault.evidence-diagnostics-ui-model.v1',available:false,reason,summary:null,diagnostics:Object.freeze([])});
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))return unavailable('Evidence diagnostics response is missing.');
 if(envelope.schema!==API_SCHEMA)return unavailable('Evidence diagnostics API schema is not recognized.');
 if(envelope.validation?.ok!==true)return unavailable('Evidence diagnostics response was not backend-validated.');
 if(envelope.data?.schema!==CATALOG_SCHEMA||envelope.data.lineageSemantics!==LINEAGE||!Array.isArray(envelope.data.diagnostics))return unavailable('Evidence diagnostics catalog is malformed.');
 const diagnostics=[]; for(const item of envelope.data.diagnostics){const v=view(item);if(!v)return unavailable('One or more evidence diagnostics are malformed.');diagnostics.push(v);}
 if(!diagnostics.length||new Set(diagnostics.map(i=>i.chainId)).size!==diagnostics.length)return unavailable('Evidence diagnostics chain set is empty or duplicated.');
 if(!envelope.data.summary||envelope.data.summary.chainCount!==diagnostics.length)return unavailable('Evidence diagnostics summary does not match chain data.');
 return Object.freeze({schema:'omegavault.evidence-diagnostics-ui-model.v1',available:true,reason:null,summary:Object.freeze({...envelope.data.summary}),diagnostics:Object.freeze(diagnostics)});
}
export function selectEvidenceDiagnostics(model,{filter='all',sort='name'}={}){
 if(!model?.available)return Object.freeze([]);
 if(!['all','errors','gaps','clear'].includes(filter))throw new TypeError(`Unknown evidence diagnostics filter: ${filter}`);
 if(!['name','gaps'].includes(sort))throw new TypeError(`Unknown evidence diagnostics sort: ${sort}`);
 let rows=[...model.diagnostics];
 if(filter==='errors')rows=rows.filter(i=>i.severity==='error');
 if(filter==='gaps')rows=rows.filter(i=>i.severity==='gaps-present');
 if(filter==='clear')rows=rows.filter(i=>i.severity==='clear');
 rows.sort((a,b)=>sort==='gaps'?((b.missingGates.length+b.insufficientEvidenceGates.length+b.blockers.length)-(a.missingGates.length+a.insufficientEvidenceGates.length+a.blockers.length))||a.name.localeCompare(b.name):a.name.localeCompare(b.name));
 return Object.freeze(rows);
}
