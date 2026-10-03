import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assessReviewerKeyTrust } from '../src/core/review-receipt.js';
import { assessReviewerTrustHistory } from '../src/core/reviewer-trust-history.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const receiptArg = arg('receipt');
const signatureArg = arg('signature');
const publicKeyArg = arg('public-key');
const trustArg = arg('trust');
const trustHistoryArg = arg('trust-history');
const trustHistorySnapshotArg = arg('trust-history-snapshot');
const requireTrusted = process.argv.includes('--require-trusted-reviewer');

if (!receiptArg || !signatureArg || !publicKeyArg || (trustArg && trustHistoryArg) || (trustHistorySnapshotArg && !trustHistoryArg) || (requireTrusted && !trustArg && !trustHistoryArg)) {
  process.stderr.write('Usage: node scripts/verify-review-receipt.js --receipt <receipt.json> --signature <signature.json> --public-key <reviewer-public.pem> [--trust <reviewer-trust.json> | --trust-history <reviewer-trust-history.json> [--trust-history-snapshot <snapshot.json>]] [--require-trusted-reviewer]\n');
  process.exit(2);
}

try {
  const receipt = JSON.parse(readFileSync(resolve(receiptArg), 'utf8'));
  const signature = JSON.parse(readFileSync(resolve(signatureArg), 'utf8'));
  const publicKey = readFileSync(resolve(publicKeyArg));
  const trustMetadata = trustArg ? JSON.parse(readFileSync(resolve(trustArg), 'utf8')) : null;
  const trustHistory = trustHistoryArg ? JSON.parse(readFileSync(resolve(trustHistoryArg), 'utf8')) : null;
  const trustHistorySnapshot = trustHistorySnapshotArg ? JSON.parse(readFileSync(resolve(trustHistorySnapshotArg), 'utf8')) : null;
  const result = trustHistory
    ? assessReviewerTrustHistory({ receipt, signature, publicKey, trustHistory, trustHistorySnapshot })
    : assessReviewerKeyTrust({ receipt, signature, publicKey, trustMetadata });
  const output = Object.freeze({
    ...result,
    reviewer: receipt?.reviewer ?? null,
    receiptSha256: receipt?.sha256 ?? null,
    publicKeySpkiSha256: signature?.publicKeySpkiSha256 ?? null,
    promotionAuthority: false
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!result.signatureAuthenticated || !result.ok || (requireTrusted && !result.reviewerTrusted)) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Review-receipt verification failed: ${error.message}\n`);
  process.exitCode = 1;
}
