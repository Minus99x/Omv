import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OMEGAVAULT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omegavault-test-'));
const { createOmegaVaultServer } = await import('../src/server.js');

const OWNER = '0x1111111111111111111111111111111111111111';
const DEST = '0x2222222222222222222222222222222222222222';
const A = '0x3333333333333333333333333333333333333333';
const CONTRACT = '0x4444444444444444444444444444444444444444';
const TX = `0x${'aa'.repeat(32)}`;
const SOURCE_HASH = '22'.repeat(32);

test('HTTP API exposes test-only runtime config, creates a vault, and binds a verified Sepolia deployment proof', async (t) => {
  const server = createOmegaVaultServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  let response = await fetch(`${base}/api/config`);
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, 'test-proof');
  assert.equal(body.mainnetTransactionsEnabled, false);
  assert.equal(body.ethereumProof.allowedNetwork.id, '0xaa36a7');

  response = await fetch(`${base}/api/vaults`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainId: 'ethereum', owner: OWNER, rescueDestination: DEST, trustedContacts: [A], threshold: 1, inactivityDays: 30 })
  });
  assert.equal(response.status, 201);
  body = await response.json();
  const id = body.vault.id;
  assert.equal(body.vault.policyState.stage, 'protected');

  response = await fetch(`${base}/api/vaults/${id}/chain/bind`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chainId: 'ethereum', networkRef: '0xaa36a7', contractRef: CONTRACT, deploymentTxRef: TX,
      testOnly: true, testInactivitySeconds: 60, adapterVersion: '0.4.0', contractVersion: '0.4.0',
      sourceSha256: SOURCE_HASH, deploymentVerified: true, verification: { checks: { runtimeCodeMatched: true } }
    })
  });
  assert.equal(response.status, 200);
  body = await response.json();
  assert.equal(body.vault.chainBindings.ethereum.contractRef, CONTRACT);
  assert.equal(body.vault.chainBindings.ethereum.deploymentVerified, true);
  assert.equal(body.vault.inactivityDays, 30);

  response = await fetch(`${base}/api/ethereum/contract-source`);
  body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.source, /contract OmegaVaultRecoveryVault/);
  assert.equal(body.contractVersion, '0.4.0');
  assert.match(body.sourceSha256, /^[a-f0-9]{64}$/);
});

test('HTTP binding endpoint refuses an unverified or mainnet Ethereum proof', async (t) => {
  const server = createOmegaVaultServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/api/vaults`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainId: 'ethereum', owner: OWNER, rescueDestination: DEST, trustedContacts: [A], threshold: 1, inactivityDays: 30 })
  });
  const { vault } = await response.json();
  response = await fetch(`${base}/api/vaults/${vault.id}/chain/bind`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chainId: 'ethereum', networkRef: '0x1', contractRef: CONTRACT, deploymentTxRef: TX,
      testOnly: true, testInactivitySeconds: 60, adapterVersion: '0.4.0', contractVersion: '0.4.0', sourceSha256: SOURCE_HASH,
      deploymentVerified: false
    })
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Sepolia|verification/);
});
