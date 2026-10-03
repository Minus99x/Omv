import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyCurrentReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor-history.js';

function arg(name) { const index=process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index+1] : null; }
const anchorPath=arg('anchor'); const historyPath=arg('history'); const snapshotPath=arg('history-snapshot');
if (!anchorPath || !historyPath || !snapshotPath) { process.stderr.write('Usage: node scripts/verify-reviewer-trust-policy-anchor-history.js --anchor <anchor.json> --history <anchor-history.json> --history-snapshot <anchor-history-snapshot.json>\n'); process.exit(2); }
try {
  const result=verifyCurrentReviewerTrustPolicyAnchor({anchor:JSON.parse(readFileSync(resolve(anchorPath),'utf8')),history:JSON.parse(readFileSync(resolve(historyPath),'utf8')),historySnapshot:JSON.parse(readFileSync(resolve(snapshotPath),'utf8'))});
  process.stdout.write(`${JSON.stringify({...result,promotionAuthority:false},null,2)}\n`); if (!result.ok) process.exitCode=1;
} catch(error) { process.stderr.write(`Policy-anchor history verification failed: ${error.message}\n`); process.exitCode=1; }

