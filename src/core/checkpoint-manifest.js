import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { evidenceDigest } from './evidence.js';

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const DEFAULT_EXCLUDES = Object.freeze([
  '.git',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  'omegavault-mvp-*.zip',
  '*.checkpoint-manifest.json'
]);

function normalizeSha(value, label) {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  return value.toLowerCase();
}

function requiredText(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function normalizeRelativePath(value, label = 'path') {
  const text = requiredText(value, label).replaceAll('\\', '/');
  if (text.startsWith('/') || text === '..' || text.startsWith('../') || text.includes('/../')) {
    throw new TypeError(`${label} must be a safe relative path.`);
  }
  return text;
}

function globMatch(path, pattern) {
  if (!pattern.includes('*')) return path === pattern || path.startsWith(`${pattern}/`);
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(path);
}

function excluded(path, patterns) {
  return patterns.some(pattern => globMatch(path, pattern));
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function walkFiles(root, current, excludes, output) {
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = resolve(current, entry.name);
    const rel = relative(root, absolute).split(sep).join('/');
    if (excluded(rel, excludes)) continue;
    if (entry.isDirectory()) {
      walkFiles(root, absolute, excludes, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const buffer = readFileSync(absolute);
    output.push(Object.freeze({ path: normalizeRelativePath(rel), sizeBytes: buffer.length, sha256: sha256Buffer(buffer) }));
  }
}

export function createSourceTreeInventory(projectRoot, { excludes = DEFAULT_EXCLUDES } = {}) {
  const root = resolve(projectRoot);
  if (!statSync(root).isDirectory()) throw new TypeError('projectRoot must be a directory.');
  const normalizedExcludes = Object.freeze([...excludes].map((value, index) => normalizeRelativePath(value, `excludes[${index}]`)));
  const files = [];
  walkFiles(root, root, normalizedExcludes, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const paths = files.map(file => file.path);
  if (new Set(paths).size !== paths.length) throw new Error('Source inventory contains duplicate paths.');
  return Object.freeze({
    schema: 'omegavault.source-tree-inventory.v1',
    excludes: normalizedExcludes,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    files: Object.freeze(files),
    sha256: evidenceDigest(files)
  });
}

function normalizeDependencyLock(binding) {
  if (!binding || binding.schema !== 'omegavault.dependency-lock.v1') throw new TypeError('A valid dependency-lock binding is required.');
  return Object.freeze({
    sha256: normalizeSha(binding.sha256, 'dependencyLock.sha256'),
    packageJsonSha256: normalizeSha(binding.packageJsonSha256, 'dependencyLock.packageJsonSha256'),
    packageLockSha256: normalizeSha(binding.packageLockSha256, 'dependencyLock.packageLockSha256'),
    lockfileVersion: Number(binding.lockfileVersion),
    nodeEngine: binding.nodeEngine == null ? null : String(binding.nodeEngine)
  });
}

function normalizeCheckpoint(checkpoint) {
  const archive = requiredText(checkpoint?.archive, 'checkpoint.archive');
  if (!archive.toLowerCase().endsWith('.zip')) throw new TypeError('checkpoint.archive must name a ZIP archive.');
  return Object.freeze({
    ref: requiredText(checkpoint?.ref, 'checkpoint.ref'),
    archive,
    archiveSha256: normalizeSha(checkpoint?.archiveSha256, 'checkpoint.archiveSha256')
  });
}

export function createCheckpointManifest({ checkpoint, dependencyLock, sourceInventory, proofBundleSha256 = null }) {
  const normalizedCheckpoint = normalizeCheckpoint(checkpoint);
  const normalizedDependencyLock = normalizeDependencyLock(dependencyLock);
  if (!sourceInventory || sourceInventory.schema !== 'omegavault.source-tree-inventory.v1') throw new TypeError('A source-tree inventory is required.');
  const normalizedSource = Object.freeze({
    sha256: normalizeSha(sourceInventory.sha256, 'sourceInventory.sha256'),
    fileCount: Number(sourceInventory.fileCount),
    totalBytes: Number(sourceInventory.totalBytes),
    excludes: Object.freeze([...sourceInventory.excludes])
  });
  const proofDigest = proofBundleSha256 == null ? null : normalizeSha(proofBundleSha256, 'proofBundleSha256');
  const core = Object.freeze({
    schema: 'omegavault.checkpoint-manifest.v1',
    checkpoint: normalizedCheckpoint,
    dependencyLock: normalizedDependencyLock,
    sourceTree: normalizedSource,
    proofBundleSha256: proofDigest
  });
  return Object.freeze({ ...core, sha256: evidenceDigest(core) });
}

export function verifyCheckpointManifest(manifest, inputs) {
  const errors = [];
  let expected;
  try {
    expected = createCheckpointManifest(inputs);
  } catch (error) {
    return Object.freeze({ ok: false, errors: Object.freeze([String(error?.message || error)]) });
  }
  if (manifest?.schema !== expected.schema) errors.push('Unexpected checkpoint-manifest schema.');
  if (manifest?.sha256 !== expected.sha256) errors.push('Checkpoint-manifest digest mismatch.');
  if (evidenceDigest(manifest?.checkpoint ?? null) !== evidenceDigest(expected.checkpoint)) errors.push('Checkpoint archive binding mismatch.');
  if (evidenceDigest(manifest?.dependencyLock ?? null) !== evidenceDigest(expected.dependencyLock)) errors.push('Dependency-lock binding mismatch.');
  if (evidenceDigest(manifest?.sourceTree ?? null) !== evidenceDigest(expected.sourceTree)) errors.push('Source-tree binding mismatch.');
  if ((manifest?.proofBundleSha256 ?? null) !== expected.proofBundleSha256) errors.push('Proof-bundle binding mismatch.');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
