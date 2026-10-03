import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';

function arg(name) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; }

const indexPath = arg('external-review-index');
const historyPath = arg('trust-history');
const snapshotPath = arg('trust-history-snapshot');
const anchoredBy = arg('anchored-by');
const anchoredAt = arg('anchored-at');
const outputPath = arg('output');

if (!indexPath || !historyPath || !snapshotPath || !anchoredBy || !anchoredAt || !outputPath) {
  process.stderr.write('Usage: node scripts/create-reviewer-trust-policy-anchor.js --external-review-index <index.json> --trust-history <history.json> --trust-history-snapshot <snapshot.json> --anchored-by <authority> --anchored-at <ISO timestamp> --output <anchor.json>\n');
  process.exit(2);
}

try {
  const anchor = createReviewerTrustPolicyAnchor({
    externalReviewIndex:JSON.parse(readFileSync(resolve(indexPath), 'utf8')),
    trustHistory:JSON.parse(readFileSync(resolve(historyPath), 'utf8')),
    trustHistorySnapshot:JSON.parse(readFileSync(resolve(snapshotPath), 'utf8')),
    anchoredBy,
    anchoredAt
  });
  writeFileSync(resolve(outputPath), `${JSON.stringify(anchor, null, 2)}\n`, { encoding:'utf8', flag:'wx' });
  process.stdout.write(`${JSON.stringify({ output:resolve(outputPath), sha256:anchor.sha256, externalReviewIndexSha256:anchor.externalReviewIndex.sha256, trustPolicySnapshotSha256:anchor.trustPolicy.snapshotSha256, promotionAuthority:false }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Reviewer trust-policy anchor creation failed: ${error.message}\n`);
  process.exitCode = 1;
}

