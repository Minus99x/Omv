import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot, verifyReviewerTrustHistory } from '../src/core/reviewer-trust-history.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const reviewer = arg('reviewer');
const publicKeyPath = arg('public-key');
const action = arg('action');
const configuredBy = arg('configured-by');
const configuredAt = arg('configured-at');
const reason = arg('reason');
const historyPath = arg('history');
const outputPath = arg('output');
const snapshotOutputPath = arg('snapshot-output');

if (!reviewer || !publicKeyPath || !action || !configuredBy || !configuredAt || !outputPath || (action !== 'enroll' && !historyPath)) {
  process.stderr.write('Usage: node scripts/append-reviewer-trust-event.js --reviewer <identity> --public-key <reviewer-public.pem> --action <enroll|rotate|revoke> --configured-by <authority> --configured-at <ISO timestamp> [--reason <text>] [--history <existing-history.json>] --output <updated-history.json>\n');
  process.exit(2);
}

try {
  const history = historyPath ? JSON.parse(readFileSync(resolve(historyPath), 'utf8')) : [];
  if (!Array.isArray(history)) throw new TypeError('Existing trust history must be a JSON array.');
  if (history.length > 0) {
    const verification = verifyReviewerTrustHistory(history);
    if (!verification.ok) throw new Error(`Existing trust history is invalid: ${verification.errors.join('; ')}`);
  }
  const event = createReviewerTrustEvent({
    reviewer,
    publicKey: readFileSync(resolve(publicKeyPath)),
    action,
    configuredBy,
    configuredAt,
    reason,
    previousEvent: history.at(-1) ?? null
  });
  const updated = Object.freeze([...history, event]);
  const verification = verifyReviewerTrustHistory(updated);
  if (!verification.ok) throw new Error(`Updated trust history is invalid: ${verification.errors.join('; ')}`);
  writeFileSync(resolve(outputPath), `${JSON.stringify(updated, null, 2)}\n`, { encoding:'utf8', flag:'wx' });
  const snapshot = createReviewerTrustHistorySnapshot(updated);
  if (snapshotOutputPath) writeFileSync(resolve(snapshotOutputPath), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding:'utf8', flag:'wx' });
  process.stdout.write(`${JSON.stringify({
    output: resolve(outputPath),
    reviewer: verification.reviewer,
    status: verification.status,
    eventCount: updated.length,
    headSha256: verification.headSha256,
    currentKeySpkiSha256: verification.currentKeySpkiSha256,
    snapshotSha256: snapshot.sha256,
    promotionAuthority: false
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Reviewer trust event append failed: ${error.message}\n`);
  process.exitCode = 1;
}
