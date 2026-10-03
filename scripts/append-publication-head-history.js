import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicationHeadHistoryEntry, createPublicationHeadHistorySnapshot, verifyPublicationHeadHistory } from '../src/core/publication-head-history.js';

function arg(name) { const index=process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index+1] : null; }
const forbidden=['--private-key','--secret-key','--seed','--key-output'].find(flag=>process.argv.includes(flag));

const receiptPath=arg('receipt');
const historyPath=arg('history');
const outputPath=arg('output');
const snapshotOutputPath=arg('snapshot-output');

if (forbidden || !receiptPath || !outputPath || !snapshotOutputPath) {
  if (forbidden) process.stderr.write(`Secret input is forbidden in publication-history tooling: ${forbidden}\n`);
  process.stderr.write('Usage: node scripts/append-publication-head-history.js --receipt <publication-receipt.json> [--history <existing-publication-history.json>] --output <updated-history.json> --snapshot-output <publication-history-snapshot.json>\n');
  process.exit(2);
}

try {
  const history=historyPath ? JSON.parse(readFileSync(resolve(historyPath),'utf8')) : [];
  if (!Array.isArray(history)) throw new TypeError('Existing publication history must be a JSON array.');
  if (history.length) {
    const verification=verifyPublicationHeadHistory(history);
    if (!verification.ok) throw new Error(`Existing publication history is invalid: ${verification.errors.join('; ')}`);
  }
  const receipt=JSON.parse(readFileSync(resolve(receiptPath),'utf8'));
  const entry=createPublicationHeadHistoryEntry({receipt,previousEntry:history.at(-1)??null});
  const updated=Object.freeze([...history,entry]);
  const snapshot=createPublicationHeadHistorySnapshot(updated);
  writeFileSync(resolve(outputPath),`${JSON.stringify(updated,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  writeFileSync(resolve(snapshotOutputPath),`${JSON.stringify(snapshot,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  process.stdout.write(`${JSON.stringify({
    output:resolve(outputPath),
    snapshotOutput:resolve(snapshotOutputPath),
    entryCount:updated.length,
    headPublicationReceiptSha256:entry.publicationReceiptSha256,
    historySnapshotSha256:snapshot.sha256,
    promotionAuthority:false
  },null,2)}\n`);
} catch(error) {
  process.stderr.write(`Publication-history append failed: ${error.message}\n`);
  process.exitCode=1;
}
