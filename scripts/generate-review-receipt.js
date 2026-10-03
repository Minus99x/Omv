import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReviewVerificationReceipt, renderReviewVerificationReceiptText, verifyReviewVerificationReceipt } from '../src/chains/review-receipt.js';
function arg(name){const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:null;}
const descriptorPath=resolve(arg('descriptor')??''); const outputPath=resolve(arg('output')??'omegavault-review-receipt.txt');
if(!arg('descriptor')){process.stderr.write('Usage: node scripts/generate-review-receipt.js --descriptor <review-bundle.json> [--output receipt.txt]\n');process.exit(2);}
const descriptor=JSON.parse(readFileSync(descriptorPath,'utf8')); const receipt=createReviewVerificationReceipt(descriptor); const verification=verifyReviewVerificationReceipt(receipt,descriptor); if(!verification.ok) throw new Error(verification.errors.join('; ')); const text=renderReviewVerificationReceiptText(receipt); writeFileSync(outputPath,text); process.stdout.write(`${JSON.stringify({output:outputPath,sha256:receipt.sha256,reviewBundleSha256:receipt.reviewBundleSha256},null,2)}\n`);
