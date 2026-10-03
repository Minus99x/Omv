import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyPublisherTrustHistory, verifyPublisherTrustHistorySnapshot } from '../src/core/publisher-trust-history.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function rejectSecretArgs() {
  for (const name of ['private-key','secret-key','seed','key-output']) {
    if (process.argv.includes(`--${name}`)) throw new Error(`Secret input --${name} is forbidden; publisher trust verification accepts public trust metadata only.`);
  }
}

try {
  rejectSecretArgs();
  const historyPath = arg('history');
  const snapshotPath = arg('snapshot');
  if (!historyPath || !snapshotPath) {
    process.stderr.write('Usage: node scripts/verify-publisher-trust-history.js --history <publisher-trust-history.json> --snapshot <publisher-trust-history-snapshot.json>\n');
    process.exit(2);
  }

  const history = JSON.parse(readFileSync(resolve(historyPath), 'utf8'));
  const snapshot = JSON.parse(readFileSync(resolve(snapshotPath), 'utf8'));
  const historyVerification = verifyPublisherTrustHistory(history);
  const snapshotVerification = verifyPublisherTrustHistorySnapshot(snapshot, history);
  const ok = historyVerification.ok && snapshotVerification.ok;

  process.stdout.write(`${JSON.stringify({
    ok,
    publisher:historyVerification.publisher,
    status:historyVerification.status,
    eventCount:Array.isArray(history) ? history.length : 0,
    headSha256:historyVerification.headSha256,
    currentKeySpkiSha256:historyVerification.currentKeySpkiSha256,
    snapshotSha256:snapshot?.sha256 ?? null,
    publisherTrustAuthority:false,
    promotionAuthority:false,
    errors:[
      ...historyVerification.errors,
      ...snapshotVerification.errors.map(error=>`Snapshot: ${error}`)
    ]
  }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Publisher trust history verification failed: ${error.message}\n`);
  process.exitCode = 1;
}
