import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createOperatorAuditIndex, createExternalReviewIndex } from '../src/chains/operator-audit-index.js';
import { createHash } from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');

test('review bundle CLI generates and verifies a portable descriptor',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ov-review-bundle-')); const checkpointRef='0.6.41-dev';
  const archive=path.join(dir,'omegavault-mvp-0.6.41-dev.zip'); fs.writeFileSync(archive,'fixture-archive'); const archiveBytes=fs.readFileSync(archive);
  const sidecar=path.join(dir,'omegavault-mvp-0.6.41-dev.checkpoint-manifest.json');
  const sidecarObj={sha256:'33'.repeat(32)}; fs.writeFileSync(sidecar,JSON.stringify(sidecarObj)); const sidecarBytes=fs.readFileSync(sidecar);
  const operatorAuditIndex=createOperatorAuditIndex({checkpointRef});
  const checkpointIdentity={checkpointRef,archiveFilename:path.basename(archive),archiveSha256:sha(archiveBytes),sidecarFilename:path.basename(sidecar),sidecarFileSha256:sha(sidecarBytes),checkpointManifestSha256:sidecarObj.sha256,sourceTreeSha256:'44'.repeat(32),dependencyLockSha256:'55'.repeat(32)};
  const reviewObj=createExternalReviewIndex({operatorAuditIndex,checkpointIdentity}); const review=path.join(dir,'omegavault-mvp-0.6.41-dev.external-review-index.json'); fs.writeFileSync(review,JSON.stringify(reviewObj));
  const descriptor=path.join(dir,'bundle.json');
  const gen=spawnSync(process.execPath,['scripts/generate-review-bundle-descriptor.js','--archive',archive,'--sidecar',sidecar,'--review-index',review,'--checkpoint-ref',checkpointRef,'--output',descriptor],{cwd:process.cwd(),encoding:'utf8'}); assert.equal(gen.status,0,gen.stderr);
  const verify=spawnSync(process.execPath,['scripts/verify-review-bundle.js','--descriptor',descriptor,'--archive',archive,'--sidecar',sidecar,'--review-index',review,'--checkpoint-ref',checkpointRef],{cwd:process.cwd(),encoding:'utf8'}); assert.equal(verify.status,0,verify.stderr); assert.equal(JSON.parse(verify.stdout).ok,true);
});
