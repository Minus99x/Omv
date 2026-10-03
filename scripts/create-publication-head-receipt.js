import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicationHeadReceipt } from '../src/core/publication-head-receipt.js';

function arg(name) { const index=process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index+1] : null; }
const forbidden=['--private-key','--secret-key','--seed','--key-output'].find(flag=>process.argv.includes(flag));
const historyPath=arg('anchor-history'); const snapshotPath=arg('anchor-history-snapshot'); const publisher=arg('publisher'); const publishedAt=arg('published-at'); const outputPath=arg('output');
if (forbidden || !historyPath || !snapshotPath || !publisher || !publishedAt || !outputPath) {
  if (forbidden) process.stderr.write(`Publisher secret input is forbidden in normal CLI tooling: ${forbidden}\n`);
  process.stderr.write('Usage: node scripts/create-publication-head-receipt.js --anchor-history <history.json> --anchor-history-snapshot <snapshot.json> --publisher <publisher> --published-at <ISO timestamp> --output <receipt.json>\n');
  process.exit(2);
}
try {
  const receipt=createPublicationHeadReceipt({history:JSON.parse(readFileSync(resolve(historyPath),'utf8')),historySnapshot:JSON.parse(readFileSync(resolve(snapshotPath),'utf8')),publisher,publishedAt});
  writeFileSync(resolve(outputPath),`${JSON.stringify(receipt,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  process.stdout.write(`${JSON.stringify({output:resolve(outputPath),sha256:receipt.sha256,headAnchorSha256:receipt.anchorHistory.headAnchorSha256,signatureStatus:'unsigned',publisherSecretHandled:false,promotionAuthority:false},null,2)}\n`);
} catch(error) { process.stderr.write(`Publication-head receipt creation failed: ${error.message}\n`); process.exitCode=1; }
