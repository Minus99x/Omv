import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'manifest.json'), 'utf8'));
const sourcePath = path.join(root, manifest.source.path);
const actual = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
if (actual !== manifest.source.sha256) {
  console.error(`Contract source hash mismatch. expected=${manifest.source.sha256} actual=${actual}`);
  process.exit(1);
}
if (manifest.productionValueAllowed !== false) {
  console.error('Test proof manifest must not allow production value.');
  process.exit(1);
}
if (manifest.network.chainIdHex !== '0xaa36a7') {
  console.error('Test proof manifest must remain pinned to Sepolia.');
  process.exit(1);
}
console.log(`Contract manifest verified: ${manifest.name} ${manifest.contractVersion} ${actual}`);
