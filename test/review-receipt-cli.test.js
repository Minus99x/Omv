import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyExternalReviewReceipt } from '../src/core/review-receipt.js';

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
