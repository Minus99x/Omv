import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createExternalReviewBasis } from '../src/chains/review-basis.js';
import { createSourceTreeInventory } from '../src/core/checkpoint-manifest.js';
import { createExternalReviewIndex } from '../src/core/external-review-index.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function fileSha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

const projectRoot = resolve(arg('project-root') ?? '.');
const archivePath = resolve(arg('archive') ?? '');
const manifestPath = resolve(arg('checkpoint-manifest') ?? '');
const outputPath = resolve(arg('output') ?? `${basename(archivePath || 'omegavault.zip', '.zip')}.review-index.json`);
if (!arg('archive') || !arg('checkpoint-manifest')) {
  process.stderr.write('Usage: node scripts/generate-external-review-index.js --archive <zip> --checkpoint-manifest <json> [--output <json>] [--project-root <dir>]\n');
  process.exit(2);
}

const sidecar = JSON.parse(readFileSync(manifestPath, 'utf8'));
const actualSourceInventory = createSourceTreeInventory(projectRoot);
if (actualSourceInventory.sha256 !== sidecar?.sourceInventory?.sha256 || actualSourceInventory.fileCount !== sidecar?.sourceInventory?.fileCount || actualSourceInventory.totalBytes !== sidecar?.sourceInventory?.totalBytes) {
  process.stderr.write('Extracted/source project tree does not match checkpoint sidecar source inventory.\n');
  process.exit(2);
}
const actualArchiveSha256 = fileSha256(archivePath);
if (actualArchiveSha256 !== sidecar?.checkpoint?.archiveSha256) {
  process.stderr.write('Archive SHA-256 does not match checkpoint manifest.\n');
  process.exit(2);
}
if (basename(archivePath) !== sidecar?.checkpoint?.archive) {
  process.stderr.write('Archive filename does not match checkpoint manifest.\n');
  process.exit(2);
}

const reviewBasis = createExternalReviewBasis();
const index = createExternalReviewIndex({
  checkpointManifest: sidecar,
  checkpointManifestFilename: basename(manifestPath),
  checkpointManifestFileSha256: fileSha256(manifestPath),
  reviewBasis
});
writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: outputPath, sha256: index.sha256, reviewBasisSha256: reviewBasis.sha256 }, null, 2)}\n`);
