import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createExternalReviewReceipt } from '../src/core/review-receipt.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function args(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  return values;
}

if (!arg('index') || !arg('outcome') || !arg('reviewer') || !arg('reviewed-at')) {
  process.stderr.write('Usage: node scripts/create-review-receipt.js --index <review-index.json> --outcome <verified|verified-with-notes|rejected> --reviewer <label> --reviewed-at <ISO> [--note <text> ...] [--output <json>]\n');
  process.exit(2);
}
const indexPath = resolve(arg('index'));
const output = resolve(arg('output') ?? 'omegavault-external-review-receipt.json');
const reviewIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
const receipt = createExternalReviewReceipt({ reviewIndex, outcome: arg('outcome'), reviewer: arg('reviewer'), reviewedAt: arg('reviewed-at'), notes: args('note') });
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, sha256: receipt.sha256, outcome: receipt.outcome, signatureStatus: receipt.signatureStatus }, null, 2)}\n`);
