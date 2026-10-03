import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyCurrentPublicationHeadReceipt } from '../src/core/publication-head-history.js';

function arg(name) { const index=process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index+1] : null; }
const forbidden=['--private-key','--secret-key','--seed','--key-output'].find(flag=>process.argv.includes(flag));

const receiptPath=arg('receipt');
const historyPath=arg('history');
const snapshotPath=arg('history-snapshot');

if (forbidden || !receiptPath || !historyPath || !snapshotPath) {
  if (forbidden) process.stderr.write(`Secret input is forbidden in publication-history tooling: ${forbidden}\n`);
  process.stderr.write('Usage: node scripts/verify-publication-head-history.js --receipt <publication-receipt.json> --history <publication-history.json> --history-snapshot <publication-history-snapshot.json>\n');
  process.exit(2);
}

try {
  const receipt=JSON.parse(readFileSync(resolve(receiptPath),'utf8'));
  const result=verifyCurrentPublicationHeadReceipt({
    receipt,
    history:JSON.parse(readFileSync(resolve(historyPath),'utf8')),
    historySnapshot:JSON.parse(readFileSync(resolve(snapshotPath),'utf8'))
  });
  process.stdout.write(`${JSON.stringify({
    ...result,
    publicationReceiptSha256:receipt?.sha256 ?? null,
    promotionAuthority:false,
    reviewerTrustAuthority:false,
    anchoringAuthorityTrust:false,
    deploymentAuthority:false,
    walletAuthority:false
  },null,2)}\n`);
  if (!result.ok) process.exitCode=1;
} catch(error) {
  process.stderr.write(`Publication-history verification failed: ${error.message}\n`);
  process.exitCode=1;
}

