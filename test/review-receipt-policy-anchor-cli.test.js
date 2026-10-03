import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { evidenceDigest } from '../src/core/evidence.js';
import { createDetachedReviewReceiptSignature, createExternalReviewReceipt } from '../src/core/review-receipt.js';
import { createReviewerTrustEvent, createReviewerTrustHistorySnapshot } from '../src/core/reviewer-trust-history.js';
import { createReviewerTrustPolicyAnchor } from '../src/core/reviewer-trust-policy-anchor.js';
import { createReviewerTrustPolicyAnchorHistoryEntry, createReviewerTrustPolicyAnchorHistorySnapshot } from '../src/core/reviewer-trust-policy-anchor-history.js';

function reviewIndex(ref) {
  const core = { schema:'omegavault.external-review-index.v1', checkpoint:{ref,archiveFilename:`${ref}.zip`,archiveSha256:'11'.repeat(32)}, checkpointManifest:{logicalSha256:'22'.repeat(32)}, reviewBasis:{sha256:'33'.repeat(32)}, verification:{sourceAncestryInference:false} };
  return { ...core, sha256:evidenceDigest(core) };
}

test('receipt CLI requires the anchored external review index to match the receipt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-receipt-anchor-'));
  const key = generateKeyPairSync('ed25519');
  const index = reviewIndex('0.6.44-dev');
  const receipt = createExternalReviewReceipt({ reviewIndex:{ schema:index.schema, sha256:index.sha256, checkpoint:{ref:index.checkpoint.ref,archiveSha256:index.checkpoint.archiveSha256}, reviewBasis:{sha256:index.reviewBasis.sha256} }, outcome:'verified', reviewer:'audit-team', reviewedAt:'2026-10-03T07:00:00Z' });
  const signature = createDetachedReviewReceiptSignature({ receipt, privateKey:key.privateKey });
  const event = createReviewerTrustEvent({ reviewer:'audit-team', publicKey:key.publicKey, action:'enroll', configuredBy:'policy', configuredAt:'2026-10-03T07:01:00Z' });
  const history = [event]; const snapshot = createReviewerTrustHistorySnapshot(history);
  const oldAnchor = createReviewerTrustPolicyAnchor({ externalReviewIndex:index, trustHistory:history, trustHistorySnapshot:snapshot, anchoredBy:'policy-registry', anchoredAt:'2026-10-03T07:01:30Z' });
  const anchor = createReviewerTrustPolicyAnchor({ externalReviewIndex:index, trustHistory:history, trustHistorySnapshot:snapshot, anchoredBy:'policy-registry', anchoredAt:'2026-10-03T07:02:00Z' });
  const oldEntry=createReviewerTrustPolicyAnchorHistoryEntry({anchor:oldAnchor});
  const anchorHistory=[oldEntry,createReviewerTrustPolicyAnchorHistoryEntry({anchor,previousEntry:oldEntry})];
  const anchorHistorySnapshot=createReviewerTrustPolicyAnchorHistorySnapshot(anchorHistory);
  const files={ receipt:path.join(dir,'receipt.json'), signature:path.join(dir,'signature.json'), key:path.join(dir,'key.pem'), index:path.join(dir,'index.json'), otherIndex:path.join(dir,'other-index.json'), history:path.join(dir,'history.json'), snapshot:path.join(dir,'snapshot.json'), anchor:path.join(dir,'anchor.json'), oldAnchor:path.join(dir,'old-anchor.json'), anchorHistory:path.join(dir,'anchor-history.json'), anchorHistorySnapshot:path.join(dir,'anchor-history-snapshot.json') };
  fs.writeFileSync(files.receipt,JSON.stringify(receipt)); fs.writeFileSync(files.signature,JSON.stringify(signature)); fs.writeFileSync(files.key,key.publicKey.export({type:'spki',format:'pem'})); fs.writeFileSync(files.index,JSON.stringify(index)); fs.writeFileSync(files.otherIndex,JSON.stringify(reviewIndex('0.6.45-dev'))); fs.writeFileSync(files.history,JSON.stringify(history)); fs.writeFileSync(files.snapshot,JSON.stringify(snapshot)); fs.writeFileSync(files.anchor,JSON.stringify(anchor)); fs.writeFileSync(files.oldAnchor,JSON.stringify(oldAnchor)); fs.writeFileSync(files.anchorHistory,JSON.stringify(anchorHistory)); fs.writeFileSync(files.anchorHistorySnapshot,JSON.stringify(anchorHistorySnapshot));
  const args=['scripts/verify-review-receipt.js','--receipt',files.receipt,'--signature',files.signature,'--public-key',files.key,'--trust-history',files.history,'--trust-history-snapshot',files.snapshot,'--trust-policy-anchor',files.anchor,'--external-review-index',files.index,'--trust-policy-anchor-history',files.anchorHistory,'--trust-policy-anchor-history-snapshot',files.anchorHistorySnapshot,'--require-trusted-reviewer'];
  const accepted=spawnSync(process.execPath,args,{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(accepted.status,0,accepted.stderr);
  const result=JSON.parse(accepted.stdout);
  assert.equal(result.trustPolicyAnchored,true);
  assert.equal(result.trustPolicyAnchorCurrent,true);
  assert.equal(result.reviewerTrusted,true);
  const rejected=spawnSync(process.execPath,args.map(value=>value===files.index?files.otherIndex:value),{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.equal(JSON.parse(rejected.stdout).reviewerTrusted,false);
  const rolledBack=spawnSync(process.execPath,args.map(value=>value===files.anchor?files.oldAnchor:value),{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(rolledBack.status,1);
  assert.equal(JSON.parse(rolledBack.stdout).trustPolicyAnchorCurrent,false);
  assert.equal(JSON.parse(rolledBack.stdout).reviewerTrusted,false);
});
