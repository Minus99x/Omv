import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createProvenanceIntegrityAudit } from '../src/chains/provenance-audit.js';

test('provenance audit CLI exports the exact deterministic audit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-audit-export-'));
  const output = path.join(dir, 'audit.json');
  const result = spawnSync(process.execPath, ['scripts/export-provenance-audit.js', output], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const written = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual(written, createProvenanceIntegrityAudit());
});
