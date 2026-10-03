import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createDetachedReviewReceiptSignature, createExternalReviewReceipt, createReviewerKeyTrustMetadata, verifyExternalReviewReceipt } from '../src/core/review-receipt.js';

test('receipt CLI creates an unsigned external-review receipt and never signs automatically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-review-receipt-'));
  const indexPath = path.join(dir, 'review-index.json');
  const output = path.join(dir, 'receipt.json');
  fs.writeFileSync(indexPath, `${JSON.stringify({ schema:'omegavault.external-review-index.v1', sha256:'11'.repeat(32), checkpoint:{ref:'0.6.40-dev',archiveSha256:'22'.repeat(32)}, reviewBasis:{sha256:'33'.repeat(32)} }, null, 2)}\n`);
  const result = spawnSync(process.execPath, ['scripts/create-review-receipt.js','--index',indexPath,'--outcome','verified-with-notes','--reviewer','audit-team','--reviewed-at','2026-10-02T23:00:00Z','--note','manual review complete','--output',output], { cwd: process.cwd(), encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(receipt.signatureStatus, 'unsigned');
  assert.equal(receipt.outcome, 'verified-with-notes');
  assert.equal(verifyExternalReviewReceipt(receipt).ok, true);
});

test('verification CLI separates signature authentication from reviewer trust', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-review-verify-'));
  const signer = generateKeyPairSync('ed25519');
  const index = { schema:'omegavault.external-review-index.v1', sha256:'11'.repeat(32), checkpoint:{ref:'0.6.41-dev',archiveSha256:'22'.repeat(32)}, reviewBasis:{sha256:'33'.repeat(32)} };
  const receipt = createExternalReviewReceipt({ reviewIndex:index, outcome:'verified', reviewer:'audit-team', reviewedAt:'2026-10-03T02:00:00Z' });
  const signature = createDetachedReviewReceiptSignature({ receipt, privateKey:signer.privateKey });
  const trust = createReviewerKeyTrustMetadata({ reviewer:'audit-team', publicKey:signer.publicKey, status:'trusted', configuredBy:'test-policy', configuredAt:'2026-10-03T02:01:00Z' });
  const receiptPath = path.join(dir, 'receipt.json');
  const signaturePath = path.join(dir, 'signature.json');
  const publicKeyPath = path.join(dir, 'reviewer-public.pem');
  const trustPath = path.join(dir, 'trust.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  fs.writeFileSync(signaturePath, JSON.stringify(signature));
  fs.writeFileSync(publicKeyPath, signer.publicKey.export({ type:'spki', format:'pem' }));
  fs.writeFileSync(trustPath, JSON.stringify(trust));

  const unsignedTrust = spawnSync(process.execPath, ['scripts/verify-review-receipt.js','--receipt',receiptPath,'--signature',signaturePath,'--public-key',publicKeyPath], { cwd:process.cwd(), encoding:'utf8' });
  assert.equal(unsignedTrust.status, 0, unsignedTrust.stderr);
  const untrustedResult = JSON.parse(unsignedTrust.stdout);
  assert.equal(untrustedResult.signatureAuthenticated, true);
  assert.equal(untrustedResult.reviewerTrusted, false);
  assert.equal(untrustedResult.decision, 'authenticated-untrusted');

  const trusted = spawnSync(process.execPath, ['scripts/verify-review-receipt.js','--receipt',receiptPath,'--signature',signaturePath,'--public-key',publicKeyPath,'--trust',trustPath,'--require-trusted-reviewer'], { cwd:process.cwd(), encoding:'utf8' });
  assert.equal(trusted.status, 0, trusted.stderr);
  const trustedResult = JSON.parse(trusted.stdout);
  assert.equal(trustedResult.signatureAuthenticated, true);
  assert.equal(trustedResult.reviewerTrusted, true);
  assert.equal(trustedResult.promotionAuthority, false);
});

test('verification CLI fails closed for wrong key and required revoked reviewer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-review-reject-'));
  const signer = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const index = { schema:'omegavault.external-review-index.v1', sha256:'11'.repeat(32), checkpoint:{ref:'0.6.41-dev',archiveSha256:'22'.repeat(32)}, reviewBasis:{sha256:'33'.repeat(32)} };
  const receipt = createExternalReviewReceipt({ reviewIndex:index, outcome:'verified', reviewer:'audit-team', reviewedAt:'2026-10-03T02:00:00Z' });
  const signature = createDetachedReviewReceiptSignature({ receipt, privateKey:signer.privateKey });
  const revoked = createReviewerKeyTrustMetadata({ reviewer:'audit-team', publicKey:signer.publicKey, status:'revoked', configuredBy:'test-policy', configuredAt:'2026-10-03T02:01:00Z' });
  const files = {
    receipt:path.join(dir,'receipt.json'), signature:path.join(dir,'signature.json'),
    signerKey:path.join(dir,'signer.pem'), otherKey:path.join(dir,'other.pem'), trust:path.join(dir,'trust.json')
  };
  fs.writeFileSync(files.receipt, JSON.stringify(receipt));
  fs.writeFileSync(files.signature, JSON.stringify(signature));
  fs.writeFileSync(files.signerKey, signer.publicKey.export({type:'spki',format:'pem'}));
  fs.writeFileSync(files.otherKey, other.publicKey.export({type:'spki',format:'pem'}));
  fs.writeFileSync(files.trust, JSON.stringify(revoked));
  const wrongKey = spawnSync(process.execPath, ['scripts/verify-review-receipt.js','--receipt',files.receipt,'--signature',files.signature,'--public-key',files.otherKey], { cwd:process.cwd(), encoding:'utf8' });
  assert.equal(wrongKey.status, 1);
  const requiredRevoked = spawnSync(process.execPath, ['scripts/verify-review-receipt.js','--receipt',files.receipt,'--signature',files.signature,'--public-key',files.signerKey,'--trust',files.trust,'--require-trusted-reviewer'], { cwd:process.cwd(), encoding:'utf8' });
  assert.equal(requiredRevoked.status, 1);
  assert.equal(JSON.parse(requiredRevoked.stdout).signatureAuthenticated, true);
  assert.equal(JSON.parse(requiredRevoked.stdout).reviewerTrusted, false);
});
