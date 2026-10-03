import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorAuditIndex, createExternalReviewIndex } from '../src/chains/operator-audit-index.js';
import { createExternalReviewBundleDescriptor, verifyExternalReviewBundleDescriptor } from '../src/chains/review-bundle.js';

function fixture(){
  const checkpointRef='0.6.41-dev';
  const operatorAuditIndex=createOperatorAuditIndex({checkpointRef});
  const checkpointIdentity={checkpointRef,archiveFilename:'omegavault-mvp-0.6.41-dev.zip',archiveSha256:'11'.repeat(32),sidecarFilename:'omegavault-mvp-0.6.41-dev.checkpoint-manifest.json',sidecarFileSha256:'22'.repeat(32),checkpointManifestSha256:'33'.repeat(32),sourceTreeSha256:'44'.repeat(32),dependencyLockSha256:'55'.repeat(32)};
  const review=createExternalReviewIndex({operatorAuditIndex,checkpointIdentity});
  const inputs={checkpointRef,operatorAuditIndex,archive:{filename:checkpointIdentity.archiveFilename,sha256:checkpointIdentity.archiveSha256,sizeBytes:1234},sidecar:{filename:checkpointIdentity.sidecarFilename,sha256:checkpointIdentity.sidecarFileSha256,sizeBytes:2345,logicalSha256:checkpointIdentity.checkpointManifestSha256},reviewIndex:{filename:'omegavault-mvp-0.6.41-dev.external-review-index.json',sha256:'66'.repeat(32),sizeBytes:3456,logicalSha256:review.sha256,parsed:review}};
  return {inputs};
}

test('review bundle descriptor deterministically binds all three external review files',()=>{const {inputs}=fixture();const first=createExternalReviewBundleDescriptor(inputs);const second=createExternalReviewBundleDescriptor(inputs);assert.deepEqual(first,second);assert.equal(first.files.length,3);assert.match(first.sha256,/^[0-9a-f]{64}$/);assert.deepEqual(verifyExternalReviewBundleDescriptor(first,inputs),{ok:true,errors:[]});});
test('review bundle descriptor explicitly avoids archive self-hash semantics',()=>{const {inputs}=fixture();const d=createExternalReviewBundleDescriptor(inputs);assert.equal(d.semantics.archiveSelfHashEmbedded,false);assert.equal(d.semantics.generatedAfterArchiveSeal,true);});
test('review bundle descriptor fails closed when an external file hash drifts',()=>{const {inputs}=fixture();const d=createExternalReviewBundleDescriptor(inputs);const changed={...inputs,archive:{...inputs.archive,sha256:'77'.repeat(32)}};assert.equal(verifyExternalReviewBundleDescriptor(d,changed).ok,false);});
test('review bundle descriptor rejects a review index whose checkpoint binding does not match',()=>{const {inputs}=fixture();const bad={...inputs,checkpointRef:'0.6.99-dev'};assert.throws(()=>createExternalReviewBundleDescriptor(bad),/invalid|different checkpoints/i);});
