const API_SCHEMA='omegavault.api.operator-audit-index.v1';
const INDEX_SCHEMA='omegavault.operator-audit-index.v1';
const SHA256=/^[0-9a-f]{64}$/i;
export function createOperatorAuditIndexUiModel(envelope){
  const unavailable=reason=>Object.freeze({schema:'omegavault.operator-audit-index-ui-model.v1',available:false,reason,index:null});
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))return unavailable('Operator audit index response is missing.');
  if(envelope.schema!==API_SCHEMA)return unavailable('Operator audit index API schema is not recognized.');
  if(envelope.validation?.ok!==true)return unavailable('Operator audit index response was not backend-validated.');
  const index=envelope.data;
  if(!index||index.schema!==INDEX_SCHEMA||!SHA256.test(String(index.sha256))||!SHA256.test(String(index.provenanceAuditSha256))||!SHA256.test(String(index.evidenceHistorySha256)))return unavailable('Operator audit index payload is malformed.');
  return Object.freeze({schema:'omegavault.operator-audit-index-ui-model.v1',available:true,reason:null,index:Object.freeze(index)});
}
