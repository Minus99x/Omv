import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyPackageLockIntegrity } from '../src/core/dependency-integrity.js';
import { createCheckpointManifest, createSourceTreeInventory } from '../src/core/checkpoint-manifest.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const projectRoot = resolve(arg('project-root') ?? '.');
const ref = arg('ref');
const archive = arg('archive');
const archiveSha256 = arg('archive-sha256');
const output = resolve(arg('output') ?? `${archive || 'omegavault'}.checkpoint-manifest.json`);
const proofBundleSha256 = arg('proof-bundle-sha256');

if (!ref || !archive || !archiveSha256) {
  process.stderr.write('Usage: node scripts/generate-checkpoint-manifest.js --ref <checkpoint> --archive <zip> --archive-sha256 <sha256> [--project-root .] [--output file] [--proof-bundle-sha256 sha256]\n');
  process.exit(2);
}

const packageJsonText = readFileSync(resolve(projectRoot, 'package.json'), 'utf8');
const packageLockText = readFileSync(resolve(projectRoot, 'package-lock.json'), 'utf8');
const dependency = verifyPackageLockIntegrity({ packageJsonText, packageLockText });
if (!dependency.ok) {
  process.stderr.write(`Dependency lock is invalid:\n${dependency.errors.map(error => `- ${error}`).join('\n')}\n`);
  process.exit(2);
}

const sourceInventory = createSourceTreeInventory(projectRoot);
const manifest = createCheckpointManifest({
  checkpoint: { ref, archive, archiveSha256 },
  dependencyLock: dependency.binding,
  sourceInventory,
  proofBundleSha256
});
const sidecar = Object.freeze({ ...manifest, sourceInventory });
writeFileSync(output, `${JSON.stringify(sidecar, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, manifestSha256: manifest.sha256, sourceTreeSha256: sourceInventory.sha256, fileCount: sourceInventory.fileCount }, null, 2)}\n`);
