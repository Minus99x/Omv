import crypto from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

export function evidenceDigest(record) {
  const payload = JSON.stringify(stable(record));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function createEvidenceRecord(input, now = new Date()) {
  if (!input?.vaultId) throw new TypeError('Evidence requires vaultId.');
  if (!input?.chainId) throw new TypeError('Evidence requires chainId.');
  if (!input?.networkRef) throw new TypeError('Evidence requires networkRef.');

  const record = {
    format: 'OmegaVault-evidence/0.5',
    generatedAt: now.toISOString(),
    appVersion: input.appVersion || '0.5.0-dev',
    vaultId: input.vaultId,
    chainId: input.chainId,
    networkRef: input.networkRef,
    mechanism: input.mechanism || null,
    binding: input.binding ? structuredClone(input.binding) : null,
    policy: input.policy ? structuredClone(input.policy) : null,
    assets: Array.isArray(input.assets) ? structuredClone(input.assets) : [],
    actions: Array.isArray(input.actions) ? structuredClone(input.actions) : [],
    finalState: input.finalState ? structuredClone(input.finalState) : null
  };
  return Object.freeze({ ...record, sha256: evidenceDigest(record) });
}

export function validateEvidenceRecord(record) {
  const errors = [];
  if (record?.format !== 'OmegaVault-evidence/0.5') errors.push('Unexpected evidence format.');
  if (!record?.vaultId) errors.push('Missing vaultId.');
  if (!record?.chainId) errors.push('Missing chainId.');
  if (!record?.networkRef) errors.push('Missing networkRef.');
  if (!Array.isArray(record?.actions)) errors.push('Missing actions array.');
  if (!record?.finalState) errors.push('Missing finalState.');
  if (!record?.sha256) errors.push('Missing evidence digest.');
  else {
    const { sha256, ...unsigned } = record;
    if (evidenceDigest(unsigned) !== sha256) errors.push('Evidence digest mismatch.');
  }
  return { ok: errors.length === 0, errors };
}
