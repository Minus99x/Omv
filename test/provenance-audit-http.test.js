import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.OMEGAVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-audit-api-'));
const { createOmegaVaultServer } = await import('../src/server.js');

test('HTTP provenance-audit endpoint returns validated deterministic audit', async t => {
  const server = createOmegaVaultServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/provenance-audit`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.schema, 'omegavault.api.provenance-integrity-audit.v1');
  assert.equal(body.validation.ok, true);
  assert.equal(body.data.lineageRecovery.status, 'not-recorded');
  assert.equal(body.data.lineageRecovery.recoveredBindingCount, 0);
});
