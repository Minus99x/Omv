import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';

function arg(name) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; }
const anchorPath = arg('anchor');
const indexPath = arg('external-review-index');
const historyPath = arg('trust-history');
const snapshotPath = arg('trust-history-snapshot');

if (!anchorPath || !indexPath || !historyPath || !snapshotPath) {
  process.stderr.write('Usage: node scripts/verify-reviewer-trust-policy-anchor.js --anchor <anchor.json> --external-review-index <index.json> --trust-history <history.json> --trust-history-snapshot <snapshot.json>\n');
  process.exit(2);
}

try {
  const anchor = JSON.parse(readFileSync(resolve(anchorPath), 'utf8'));
  const result = verifyReviewerTrustPolicyAnchor(anchor, {
    externalReviewIndex:JSON.parse(readFileSync(resolve(indexPath), 'utf8')),
    trustHistory:JSON.parse(readFileSync(resolve(historyPath), 'utf8')),
    trustHistorySnapshot:JSON.parse(readFileSync(resolve(snapshotPath), 'utf8')),
    anchoredBy:anchor?.anchoredBy,
    anchoredAt:anchor?.anchoredAt
  });
  process.stdout.write(`${JSON.stringify({ ...result, anchorSha256:anchor?.sha256 ?? null, promotionAuthority:false }, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Reviewer trust-policy anchor verification failed: ${error.message}\n`);
  process.exitCode = 1;
}

