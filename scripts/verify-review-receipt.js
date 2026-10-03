import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReviewVerificationReceipt, renderReviewVerificationReceiptText } from '../src/chains/review-receipt.js';
function arg(name){const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:null;}
const descriptorPath=resolve(arg('descriptor')??''); const receiptPath=resolve(arg('receipt')??''); if(!arg('descriptor')||!arg('receipt')){process.stderr.write('Usage: node scripts/verify-review-receipt.js --descriptor <review-bundle.json> --receipt <receipt.txt>\n');process.exit(2);}
const descriptor=JSON.parse(readFileSync(descriptorPath,'utf8')); const observed=readFileSync(receiptPath,'utf8'); const expected=renderReviewVerificationReceiptText(createReviewVerificationReceipt(descriptor)); const ok=observed===expected; process.stdout.write(`${JSON.stringify({ok,expectedBytes:Buffer.byteLength(expected),observedBytes:Buffer.byteLength(observed)},null,2)}\n`); if(!ok) process.exitCode=1;
