import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublisherTrustEvent, createPublisherTrustHistorySnapshot, verifyPublisherTrustHistory } from '../src/core/publisher-trust-history.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function rejectSecretArgs() {
  for (const name of ['private-key','secret-key','seed','key-output']) {
    if (process.argv.includes(`--${name}`)) throw new Error(`Secret input --${name} is forbidden; publisher trust tooling accepts public keys only.`);
  }
}

try {
  rejectSecretArgs();
  const publisher = arg('publisher');
  const publicKeyPath = arg('public-key');
  const action = arg('action');
  const configuredBy = arg('configured-by');
  const configuredAt = arg('configured-at');
  const reason = arg('reason');
  const historyPath = arg('history');
  const outputPath = arg('output');
  const snapshotOutputPath = arg('snapshot-output');

  if (!publisher || !publicKeyPath || !action || !configuredBy || !configuredAt || !outputPath || (action !== 'enroll' && !historyPath)) {
    process.stderr.write('Usage: node scripts/append-publisher-trust-event.js --publisher <identity> --public-key <publisher-public.pem> --action <enroll|rotate|revoke> --configured-by <authority> --configured-at <ISO timestamp> [--reason <text>] [--history <existing-history.json>] --output <updated-history.json> [--snapshot-output <snapshot.json>]\n');
    process.exit(2);
  }

  const resolvedOutputPath = resolve(outputPath);
  const resolvedSnapshotOutputPath = snapshotOutputPath ? resolve(snapshotOutputPath) : null;
  if (resolvedSnapshotOutputPath && resolvedSnapshotOutputPath === resolvedOutputPath) throw new Error('History output and snapshot output must use different paths.');
  if (existsSync(resolvedOutputPath)) throw new Error(`Output already exists: ${resolvedOutputPath}`);
  if (resolvedSnapshotOutputPath && existsSync(resolvedSnapshotOutputPath)) throw new Error(`Snapshot output already exists: ${resolvedSnapshotOutputPath}`);

  const history = historyPath ? JSON.parse(readFileSync(resolve(historyPath), 'utf8')) : [];
  if (!Array.isArray(history)) throw new TypeError('Existing publisher trust history must be a JSON array.');
  if (history.length > 0) {
    const verification = verifyPublisherTrustHistory(history);
    if (!verification.ok) throw new Error(`Existing publisher trust history is invalid: ${verification.errors.join('; ')}`);
  }

  const event = createPublisherTrustEvent({
    publisher,
    publicKey:readFileSync(resolve(publicKeyPath)),
    action,
    configuredBy,
    configuredAt,
    reason,
    previousEvent:history.at(-1) ?? null
  });
  const updated = Object.freeze([...history, event]);
  const verification = verifyPublisherTrustHistory(updated);
  if (!verification.ok) throw new Error(`Updated publisher trust history is invalid: ${verification.errors.join('; ')}`);

  const snapshot = createPublisherTrustHistorySnapshot(updated);
  writeFileSync(resolvedOutputPath, `${JSON.stringify(updated, null, 2)}\n`, { encoding:'utf8', flag:'wx' });
  if (resolvedSnapshotOutputPath) writeFileSync(resolvedSnapshotOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding:'utf8', flag:'wx' });

  process.stdout.write(`${JSON.stringify({
    output:resolvedOutputPath,
    publisher:verification.publisher,
    status:verification.status,
    eventCount:updated.length,
    headSha256:verification.headSha256,
    currentKeySpkiSha256:verification.currentKeySpkiSha256,
    snapshotSha256:snapshot.sha256,
    publisherTrustAuthority:false,
    promotionAuthority:false
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Publisher trust event append failed: ${error.message}\n`);
  process.exitCode = 1;
}
