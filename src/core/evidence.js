import crypto from 'node:crypto';

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const SUPPORTED_FORMATS = new Set(['OmegaVault-evidence/0.5', 'OmegaVault-evidence/0.6']);

function canonicalize(value, path = '$', seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    return value;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`${path} contains unsupported evidence data.`);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${path} contains a cyclic evidence structure.`);
    seen.add(value);
    const result = value.map((item, index) => canonicalize(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must contain plain evidence objects only.`);
    if (seen.has(value)) throw new TypeError(`${path} contains a cyclic evidence structure.`);
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key], `${path}.${key}`, seen);
    seen.delete(value);
    return result;
  }
  throw new TypeError(`${path} contains unsupported evidence data.`);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function optionalSha256(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return value.toLowerCase();
}

export function canonicalEvidenceJson(record) {
  return JSON.stringify(canonicalize(record));
}

export function evidenceDigest(record) {
  return crypto.createHash('sha256').update(canonicalEvidenceJson(record)).digest('hex');
}

export function createEvidenceRecord(input, now = new Date()) {
  if (!input?.vaultId) throw new TypeError('Evidence requires vaultId.');
  if (!input?.chainId) throw new TypeError('Evidence requires chainId.');
  if (!input?.networkRef) throw new TypeError('Evidence requires networkRef.');
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Evidence requires a valid generation time.');

  const parentEvidenceSha256 = optionalSha256(input.parentEvidenceSha256, 'parentEvidenceSha256');
  const checkpointSha256 = optionalSha256(input.checkpoint?.sha256, 'checkpoint.sha256');
  const checkpointRef = input.checkpoint?.ref == null ? null : String(input.checkpoint.ref).trim();
  if (checkpointSha256 && !checkpointRef) throw new TypeError('checkpoint.ref is required when checkpoint.sha256 is supplied.');
  if (checkpointRef && !checkpointSha256) throw new TypeError('checkpoint.sha256 is required when checkpoint.ref is supplied.');

  const record = {
    format: 'OmegaVault-evidence/0.6',
    generatedAt: now.toISOString(),
    appVersion: input.appVersion || '0.6-dev',
    vaultId: input.vaultId,
    chainId: input.chainId,
    networkRef: input.networkRef,
    mechanism: input.mechanism || null,
    lineage: {
      parentEvidenceSha256,
      checkpoint: checkpointSha256 ? { ref: checkpointRef, sha256: checkpointSha256 } : null
    },
    binding: input.binding ? canonicalize(input.binding, '$.binding') : null,
    policy: input.policy ? canonicalize(input.policy, '$.policy') : null,
    assets: Array.isArray(input.assets) ? canonicalize(input.assets, '$.assets') : [],
    actions: Array.isArray(input.actions) ? canonicalize(input.actions, '$.actions') : [],
    finalState: input.finalState ? canonicalize(input.finalState, '$.finalState') : null
  };

  // Canonicalization is deliberately performed before returning so unsupported,
  // ambiguous or cyclic values fail closed instead of disappearing from JSON.
  canonicalEvidenceJson(record);
  return deepFreeze({ ...record, sha256: evidenceDigest(record) });
}

export function validateEvidenceRecord(record) {
  const errors = [];
  if (!SUPPORTED_FORMATS.has(record?.format)) errors.push('Unexpected evidence format.');
  if (!record?.vaultId) errors.push('Missing vaultId.');
  if (!record?.chainId) errors.push('Missing chainId.');
  if (!record?.networkRef) errors.push('Missing networkRef.');
  if (!Array.isArray(record?.actions)) errors.push('Missing actions array.');
  if (!record?.finalState) errors.push('Missing finalState.');

  if (record?.format === 'OmegaVault-evidence/0.6') {
    const parent = record?.lineage?.parentEvidenceSha256;
    const checkpoint = record?.lineage?.checkpoint;
    if (parent != null && (typeof parent !== 'string' || !SHA256_HEX.test(parent))) errors.push('Invalid parent evidence digest.');
    if (checkpoint != null) {
      if (!checkpoint?.ref) errors.push('Missing checkpoint ref.');
      if (typeof checkpoint?.sha256 !== 'string' || !SHA256_HEX.test(checkpoint.sha256)) errors.push('Invalid checkpoint digest.');
    }
  }

  if (!record?.sha256) errors.push('Missing evidence digest.');
  else {
    try {
      const { sha256, ...unsigned } = record;
      if (evidenceDigest(unsigned) !== sha256) errors.push('Evidence digest mismatch.');
    } catch (error) {
      errors.push(`Evidence canonicalization failed: ${String(error?.message || error)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
