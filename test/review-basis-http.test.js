import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.OMEGAVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-review-basis-api-'));
const { createOmegaVaultServer } = await import('../src/server.js');

test('HTTP review-basis endpoint returns validated audit/history binding', async t => {
  const server = createOmegaVaultServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/review-basis`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.schema, 'omegavault.api.external-review-basis.v1');
  assert.equal(body.validation.ok, true);
  assert.match(body.data.sha256, /^[0-9a-f]{64}$/);
  assert.equal(body.data.semantics.externalCheckpointIdentity, 'checkpoint-sidecar-only');
});
