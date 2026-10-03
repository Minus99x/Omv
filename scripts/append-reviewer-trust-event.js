import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const forbidden=['--private-key','--secret-key','--seed','--key-output'].find(flag=>process.argv.includes(flag));

if (forbidden || !reviewer || !publicKeyPath || !action || !configuredBy || !configuredAt || !outputPath || (action !== 'enroll' && !historyPath)) {
  if (forbidden) process.stderr.write(`Secret input is forbidden in reviewer-trust tooling: ${forbidden}\n`);
  process.stderr.write('Usage: node scripts/append-reviewer-trust-event.js --reviewer <identity> --public-key <reviewer-public.pem> --action <enroll|rotate|revoke> --configured-by <authority> --configured-at <ISO timestamp> [--reason <text>] [--history <existing-history.json>] --output <updated-history.json> [--snapshot-output <snapshot.json>]\n');
  process.exit(2);
}

try {
  const resolvedOutputPath=resolve(outputPath);
  const resolvedSnapshotOutputPath=snapshotOutputPath ? resolve(snapshotOutputPath) : null;
  if (resolvedSnapshotOutputPath && resolvedSnapshotOutputPath===resolvedOutputPath) throw new Error('History output and snapshot output must use different paths.');
  if (existsSync(resolvedOutputPath)) throw new Error(`Output already exists: ${resolvedOutputPath}`);
  if (resolvedSnapshotOutputPath && existsSync(resolvedSnapshotOutputPath)) throw new Error(`Snapshot output already exists: ${resolvedSnapshotOutputPath}`);
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
  const snapshot = createReviewerTrustHistorySnapshot(updated);
  writeFileSync(resolvedOutputPath, `${JSON.stringify(updated, null, 2)}\n`, { encoding:'utf8', flag:'wx' });
  if (resolvedSnapshotOutputPath) writeFileSync(resolvedSnapshotOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding:'utf8', flag:'wx' });
  process.stdout.write(`${JSON.stringify({
    output: resolvedOutputPath,
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
