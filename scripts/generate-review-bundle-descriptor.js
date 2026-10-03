import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createOperatorAuditIndex } from '../src/chains/operator-audit-index.js';
import { createExternalReviewBundleDescriptor, verifyExternalReviewBundleDescriptor } from '../src/chains/review-bundle.js';

function arg(name) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; }
function sha(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
const archivePath = resolve(arg('archive') ?? '');
const sidecarPath = resolve(arg('sidecar') ?? '');
const reviewIndexPath = resolve(arg('review-index') ?? '');
const checkpointRef = arg('checkpoint-ref');
const outputPath = resolve(arg('output') ?? 'omegavault-review-bundle.json');
if (!arg('archive') || !arg('sidecar') || !arg('review-index') || !checkpointRef) {
  process.stderr.write('Usage: node scripts/generate-review-bundle-descriptor.js --archive <zip> --sidecar <manifest.json> --review-index <review-index.json> --checkpoint-ref <0.6.xx-dev> [--output file]\n');
  process.exit(2);
}
const archiveBytes = readFileSync(archivePath);
const sidecarBytes = readFileSync(sidecarPath);
const reviewBytes = readFileSync(reviewIndexPath);
const sidecar = JSON.parse(sidecarBytes.toString('utf8'));
const review = JSON.parse(reviewBytes.toString('utf8'));
const operatorAuditIndex = createOperatorAuditIndex({ checkpointRef });
const inputs = {
  checkpointRef,
  operatorAuditIndex,
  archive: { filename: basename(archivePath), sha256: sha(archiveBytes), sizeBytes: archiveBytes.length },
  sidecar: { filename: basename(sidecarPath), sha256: sha(sidecarBytes), sizeBytes: sidecarBytes.length, logicalSha256: sidecar.sha256 },
  reviewIndex: { filename: basename(reviewIndexPath), sha256: sha(reviewBytes), sizeBytes: reviewBytes.length, logicalSha256: review.sha256, parsed: review }
};
const descriptor = createExternalReviewBundleDescriptor(inputs);
const verification = verifyExternalReviewBundleDescriptor(descriptor, inputs);
if (!verification.ok) throw new Error(`Review bundle verification failed: ${verification.errors.join('; ')}`);
writeFileSync(outputPath, `${JSON.stringify(descriptor, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: outputPath, sha256: descriptor.sha256, checkpointRef, fileCount: descriptor.files.length }, null, 2)}\n`);
