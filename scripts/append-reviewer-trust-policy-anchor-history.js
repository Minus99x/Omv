import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReviewerTrustPolicyAnchorHistoryEntry, createReviewerTrustPolicyAnchorHistorySnapshot, verifyReviewerTrustPolicyAnchorHistory } from '../src/core/reviewer-trust-policy-anchor-history.js';

function arg(name) { const index=process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index+1] : null; }
const anchorPath=arg('anchor'); const historyPath=arg('history'); const outputPath=arg('output'); const snapshotOutputPath=arg('snapshot-output');
if (!anchorPath || !outputPath || !snapshotOutputPath) { process.stderr.write('Usage: node scripts/append-reviewer-trust-policy-anchor-history.js --anchor <anchor.json> [--history <existing-history.json>] --output <updated-history.json> --snapshot-output <history-snapshot.json>\n'); process.exit(2); }
try {
  const history=historyPath ? JSON.parse(readFileSync(resolve(historyPath),'utf8')) : [];
  if (!Array.isArray(history)) throw new TypeError('Existing policy-anchor history must be a JSON array.');
  if (history.length) { const verification=verifyReviewerTrustPolicyAnchorHistory(history); if (!verification.ok) throw new Error(`Existing policy-anchor history is invalid: ${verification.errors.join('; ')}`); }
  const anchor=JSON.parse(readFileSync(resolve(anchorPath),'utf8'));
  const entry=createReviewerTrustPolicyAnchorHistoryEntry({anchor,previousEntry:history.at(-1)??null});
  const updated=Object.freeze([...history,entry]); const snapshot=createReviewerTrustPolicyAnchorHistorySnapshot(updated);
  writeFileSync(resolve(outputPath),`${JSON.stringify(updated,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  writeFileSync(resolve(snapshotOutputPath),`${JSON.stringify(snapshot,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  process.stdout.write(`${JSON.stringify({output:resolve(outputPath),snapshotOutput:resolve(snapshotOutputPath),entryCount:updated.length,headAnchorSha256:entry.anchorSha256,historySnapshotSha256:snapshot.sha256,promotionAuthority:false},null,2)}\n`);
} catch(error) { process.stderr.write(`Policy-anchor history append failed: ${error.message}\n`); process.exitCode=1; }

