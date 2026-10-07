import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OMEGAVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-capability-api-'));
const { createOmegaVaultServer } = await import('../src/server.js');

test('HTTP capability API is validated and keeps offline-verified Stellar visible without live promotion', async (t) => {
  const server = createOmegaVaultServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chain-capabilities`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.schema, 'omegavault.api.chain-capabilities.v1');
  assert.equal(body.validation.ok, true);
  const stellar = body.data.contracts.find(contract => contract.chainId === 'stellar');
  assert.ok(stellar);
  assert.equal(stellar.promotion.eligible, false);
  assert.equal(stellar.stage, 'offline-verified');
  assert.equal(stellar.gateEvidence['address-validation'].evidenceSufficient, true);
  assert.equal(stellar.gateEvidence['evidence-export'].evidenceSufficient, true);
  assert.ok(stellar.blockers.some(value => /Stellar Testnet/.test(value)));
  assert.equal(stellar.blockers.some(value => value.includes('@stellar/stellar-sdk')), false);
  const xdc = body.data.contracts.find(contract => contract.chainId === 'xdc');
  assert.ok(xdc);
  assert.equal(xdc.promotion.eligible, false);
  assert.equal(xdc.gateEvidence['address-validation'].evidenceSufficient, true);
});
