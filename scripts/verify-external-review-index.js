import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createExternalReviewBasis } from '../src/chains/review-basis.js';
import { verifyWorkstationCheckpointSource } from '../src/core/workstation-checkpoint-gate.js';
import { verifyExternalReviewIndex } from '../src/core/external-review-index.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function fileSha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

if (!arg('index') || !arg('archive') || !arg('checkpoint-manifest')) {
  process.stderr.write('Usage: node scripts/verify-external-review-index.js --index <json> --archive <zip> --checkpoint-manifest <json> [--project-root <dir>]\n');
  process.exit(2);
}
const projectRoot = resolve(arg('project-root') ?? '.');
const indexPath = resolve(arg('index'));
const archivePath = resolve(arg('archive'));
const manifestPath = resolve(arg('checkpoint-manifest'));
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const sidecar = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sourceGate = verifyWorkstationCheckpointSource({
  projectRoot,
  checkpointManifest: sidecar,
  sourceArchivePath: archivePath
});
if (!sourceGate.ok) {
  process.stderr.write(`Extracted/source project tree does not match checkpoint sidecar source inventory: ${sourceGate.errors.join('; ')}\n`);
  process.exit(2);
}
const archiveSha256 = fileSha256(archivePath);
if (archiveSha256 !== sidecar?.checkpoint?.archiveSha256 || basename(archivePath) !== sidecar?.checkpoint?.archive) {
  process.stderr.write('Archive does not match checkpoint manifest.\n');
  process.exit(2);
}
const result = verifyExternalReviewIndex(index, {
  checkpointManifest: sidecar,
  checkpointManifestFilename: basename(manifestPath),
  checkpointManifestFileSha256: fileSha256(manifestPath),
  reviewBasis: createExternalReviewBasis()
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 2;
