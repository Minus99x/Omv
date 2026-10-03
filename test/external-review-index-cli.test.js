import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createCheckpointManifest } from '../src/core/checkpoint-manifest.js';

const sha = value => createHash('sha256').update(value).digest('hex');

test('external review-index CLI binds actual archive bytes and checkpoint sidecar', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-external-review-'));
  const archive=path.join(dir,'omegavault-mvp-0.6.40-dev.zip');
  const sidecar=path.join(dir,'omegavault-mvp-0.6.40-dev.checkpoint-manifest.json');
  const output=path.join(dir,'review.json');
  const archiveBytes=Buffer.from('fixture archive bytes');
  fs.writeFileSync(archive,archiveBytes);
  const dependencyLock={schema:'omegavault.dependency-lock.v1',sha256:'11'.repeat(32),packageJsonSha256:'22'.repeat(32),packageLockSha256:'33'.repeat(32),lockfileVersion:3,nodeEngine:'>=22.12'};
  const sourceInventory={schema:'omegavault.source-tree-inventory.v1',excludes:[],fileCount:1,totalBytes:7,files:[{path:'a.txt',sizeBytes:7,sha256:'44'.repeat(32)}],sha256:'55'.repeat(32)};
  const manifest=createCheckpointManifest({checkpoint:{ref:'0.6.40-dev',archive:path.basename(archive),archiveSha256:sha(archiveBytes)},dependencyLock,sourceInventory});
  fs.writeFileSync(sidecar,JSON.stringify({...manifest,sourceInventory},null,2)+'\n');
  const result=spawnSync(process.execPath,['scripts/generate-external-review-index.js','--archive',archive,'--sidecar',sidecar,'--checkpoint-ref','0.6.40-dev','--output',output],{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const review=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(review.schema,'omegavault.external-review-index.v1');
  assert.equal(review.checkpointIdentity.archiveSha256,sha(archiveBytes));
  assert.equal(review.checkpointIdentity.sidecarFileSha256,sha(fs.readFileSync(sidecar)));
  assert.equal(review.verificationSemantics.archiveSelfHashEmbedded,false);
});
