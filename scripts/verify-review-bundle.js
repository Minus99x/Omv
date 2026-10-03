import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createOperatorAuditIndex } from '../src/chains/operator-audit-index.js';
import { verifyExternalReviewBundleDescriptor } from '../src/chains/review-bundle.js';
function arg(name) { const index=process.argv.indexOf(`--${name}`); return index>=0?process.argv[index+1]:null; }
function sha(buffer){ return createHash('sha256').update(buffer).digest('hex'); }
const descriptorPath=resolve(arg('descriptor')??''); const archivePath=resolve(arg('archive')??''); const sidecarPath=resolve(arg('sidecar')??''); const reviewPath=resolve(arg('review-index')??''); const checkpointRef=arg('checkpoint-ref');
if(!arg('descriptor')||!arg('archive')||!arg('sidecar')||!arg('review-index')||!checkpointRef){process.stderr.write('Usage: node scripts/verify-review-bundle.js --descriptor <bundle.json> --archive <zip> --sidecar <manifest.json> --review-index <review.json> --checkpoint-ref <0.6.xx-dev>\n');process.exit(2);}
const descriptor=JSON.parse(readFileSync(descriptorPath,'utf8')); const archiveBytes=readFileSync(archivePath); const sidecarBytes=readFileSync(sidecarPath); const reviewBytes=readFileSync(reviewPath); const sidecar=JSON.parse(sidecarBytes); const review=JSON.parse(reviewBytes); const operatorAuditIndex=createOperatorAuditIndex({checkpointRef});
const inputs={checkpointRef,operatorAuditIndex,archive:{filename:basename(archivePath),sha256:sha(archiveBytes),sizeBytes:archiveBytes.length},sidecar:{filename:basename(sidecarPath),sha256:sha(sidecarBytes),sizeBytes:sidecarBytes.length,logicalSha256:sidecar.sha256},reviewIndex:{filename:basename(reviewPath),sha256:sha(reviewBytes),sizeBytes:reviewBytes.length,logicalSha256:review.sha256,parsed:review}};
const result=verifyExternalReviewBundleDescriptor(descriptor,inputs); process.stdout.write(`${JSON.stringify({ok:result.ok,errors:result.errors,descriptorSha256:descriptor.sha256},null,2)}\n`); if(!result.ok) process.exitCode=1;
