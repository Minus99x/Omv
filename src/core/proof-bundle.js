import { evidenceDigest } from './evidence.js';

const SHA256_HEX = /^[0-9a-f]{64}$/i;

function normalizeSha(value, label) {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return value.toLowerCase();
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function normalizeCheckpoint(checkpoint) {
  const ref = requiredText(checkpoint?.ref, 'checkpoint.ref');
  const archive = requiredText(checkpoint?.archive, 'checkpoint.archive');
  if (!/\.zip$/i.test(archive)) throw new TypeError('checkpoint.archive must name the exact checkpoint ZIP archive.');
  return Object.freeze({
    ref,
    archive,
    archiveSha256: normalizeSha(checkpoint?.archiveSha256, 'checkpoint.archiveSha256'),
    dependencyLockSha256: normalizeSha(checkpoint?.dependencyLockSha256, 'checkpoint.dependencyLockSha256')
  });
}

function normalizeProofEntry(entry, index) {
  const kind = requiredText(entry?.kind, `proofs[${index}].kind`);
  const chainId = requiredText(entry?.chainId, `proofs[${index}].chainId`);
  const networkRef = requiredText(entry?.networkRef, `proofs[${index}].networkRef`);
  if (!entry || typeof entry.proof !== 'object' || entry.proof === null || Array.isArray(entry.proof)) {
    throw new TypeError(`proofs[${index}].proof must be a plain proof object.`);
  }
  const proofSha256 = evidenceDigest(entry.proof);
  const declaredSha256 = entry.proof.sha256 == null ? null : normalizeSha(entry.proof.sha256, `proofs[${index}].proof.sha256`);
  return Object.freeze({ kind, chainId, networkRef, proofSha256, declaredSha256 });
}

function normalizeParent(value) {
  if (value == null) return null;
  return normalizeSha(value, 'parentBundleSha256');
}

export function createCheckpointBoundProofBundle({ checkpoint, proofs, parentBundleSha256 = null }) {
  const normalizedCheckpoint = normalizeCheckpoint(checkpoint);
  if (!Array.isArray(proofs) || proofs.length < 1) throw new TypeError('At least one chain proof is required.');
  const normalizedProofs = Object.freeze(proofs.map(normalizeProofEntry));
  const identities = normalizedProofs.map(entry => `${entry.chainId}|${entry.networkRef}|${entry.kind}`);
  if (new Set(identities).size !== identities.length) throw new Error('Proof bundle contains duplicate chain/network/kind entries.');

  const core = Object.freeze({
    schema: 'omegavault.checkpoint-proof-bundle.v1',
    checkpoint: normalizedCheckpoint,
    parentBundleSha256: normalizeParent(parentBundleSha256),
    proofs: normalizedProofs
  });

  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyCheckpointBoundProofBundle(bundle, { checkpoint, proofs }) {
  const errors = [];
  let expected;
  try {
    expected = createCheckpointBoundProofBundle({
      checkpoint,
      proofs,
      parentBundleSha256: bundle?.parentBundleSha256 ?? null
    });
  } catch (error) {
    return Object.freeze({ ok: false, errors: Object.freeze([String(error?.message || error)]) });
  }

  if (bundle?.schema !== expected.schema) errors.push('Unexpected proof-bundle schema.');
  if (bundle?.sha256 !== expected.sha256) errors.push('Proof-bundle digest mismatch.');
  if (evidenceDigest(bundle?.checkpoint ?? null) !== evidenceDigest(expected.checkpoint)) errors.push('Checkpoint/archive binding mismatch.');
  if (evidenceDigest(bundle?.proofs ?? null) !== evidenceDigest(expected.proofs)) errors.push('Chain-proof binding mismatch.');
  if ((bundle?.parentBundleSha256 ?? null) !== expected.parentBundleSha256) errors.push('Parent proof-bundle binding mismatch.');

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
