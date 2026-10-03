import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { verifyCheckpointManifest } from '../src/core/checkpoint-manifest.js';
import { createOperatorAuditIndex, createExternalReviewIndex, verifyExternalReviewIndex } from '../src/chains/operator-audit-index.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function hash(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

const archivePath = resolve(arg('archive') ?? '');
const sidecarPath = resolve(arg('sidecar') ?? '');
const outputPath = resolve(arg('output') ?? 'omegavault-external-review-index.json');
const checkpointRef = arg('checkpoint-ref');
if (!arg('archive') || !arg('sidecar') || !checkpointRef) {
  process.stderr.write('Usage: node scripts/generate-external-review-index.js --archive <zip> --sidecar <checkpoint-manifest.json> --checkpoint-ref <0.6.xx-dev> [--output file]\n');
  process.exit(2);
}

const archiveBytes = readFileSync(archivePath);
const sidecarBytes = readFileSync(sidecarPath);
const sidecar = JSON.parse(sidecarBytes.toString('utf8'));
const archiveSha256 = hash(archiveBytes);
const sidecarFileSha256 = hash(sidecarBytes);
if (sidecar?.checkpoint?.ref !== checkpointRef) throw new Error('Sidecar checkpoint ref does not match --checkpoint-ref.');
if (sidecar?.checkpoint?.archive !== basename(archivePath)) throw new Error('Sidecar archive filename does not match the supplied archive.');
if (sidecar?.checkpoint?.archiveSha256 !== archiveSha256) throw new Error('Supplied archive SHA-256 does not match the checkpoint sidecar.');

const dependencyLockInput = { schema: 'omegavault.dependency-lock.v1', ...sidecar.dependencyLock };
const manifestVerification = verifyCheckpointManifest(sidecar, {
  checkpoint: sidecar.checkpoint,
  dependencyLock: dependencyLockInput,
  sourceInventory: sidecar.sourceInventory,
  proofBundleSha256: sidecar.proofBundleSha256 ?? null
});
if (!manifestVerification.ok) throw new Error(`Checkpoint sidecar validation failed: ${manifestVerification.errors.join('; ')}`);

const operatorAuditIndex = createOperatorAuditIndex({ checkpointRef });
const checkpointIdentity = {
  checkpointRef,
  archiveFilename: basename(archivePath),
  archiveSha256,
  sidecarFilename: basename(sidecarPath),
  sidecarFileSha256,
  checkpointManifestSha256: sidecar.sha256,
  sourceTreeSha256: sidecar.sourceTree.sha256,
  dependencyLockSha256: sidecar.dependencyLock.sha256
};
const externalReviewIndex = createExternalReviewIndex({ operatorAuditIndex, checkpointIdentity });
const reviewVerification = verifyExternalReviewIndex(externalReviewIndex, { operatorAuditIndex, checkpointIdentity });
if (!reviewVerification.ok) throw new Error(`External review-index verification failed: ${reviewVerification.errors.join('; ')}`);
writeFileSync(outputPath, `${JSON.stringify(externalReviewIndex, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: outputPath, sha256: externalReviewIndex.sha256, operatorAuditIndexSha256: operatorAuditIndex.sha256, checkpointManifestSha256: sidecar.sha256, archiveSha256 }, null, 2)}\n`);
