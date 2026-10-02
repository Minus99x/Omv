import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.OMEGAVAULT_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-history-api-'));
const { createOmegaVaultServer }=await import('../src/server.js');
test('HTTP evidence-history endpoint returns a validated diagnostic timeline', async t=>{const server=createOmegaVaultServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>server.close(r))); const response=await fetch(`http://127.0.0.1:${server.address().port}/api/evidence-history`); const body=await response.json(); assert.equal(response.status,200); assert.equal(body.schema,'omegavault.api.evidence-history.v1'); assert.equal(body.validation.ok,true); assert.equal(body.data.relationSemantics,'evidence-checkpoint-order-not-source-ancestry');});
