const API_SCHEMA = 'omegavault.api.provenance-integrity-audit.v1';
const AUDIT_SCHEMA = 'omegavault.provenance-integrity-audit.v1';
const SHA256 = /^[0-9a-f]{64}$/i;

export function createProvenanceAuditUiModel(envelope) {
  const unavailable = reason => Object.freeze({ schema: 'omegavault.provenance-audit-ui-model.v1', available: false, reason, audit: null });
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return unavailable('Provenance audit response is missing.');
  if (envelope.schema !== API_SCHEMA) return unavailable('Provenance audit API schema is not recognized.');
  if (envelope.validation?.ok !== true) return unavailable('Provenance audit response was not backend-validated.');
  const audit = envelope.data;
  if (!audit || audit.schema !== AUDIT_SCHEMA || typeof audit.sha256 !== 'string' || !SHA256.test(audit.sha256)) return unavailable('Provenance audit payload is malformed.');
  if (!audit.lineageRecovery || !['not-recorded', 'partial', 'complete'].includes(audit.lineageRecovery.status)) return unavailable('Provenance lineage recovery state is malformed.');
  return Object.freeze({ schema: 'omegavault.provenance-audit-ui-model.v1', available: true, reason: null, audit: Object.freeze(audit) });
}

export function serializeValidatedProvenanceAudit(model) {
  if (!model?.available || !model.audit) throw new Error('A backend-validated provenance audit is required before export.');
  return `${JSON.stringify(model.audit, null, 2)}\n`;
}
