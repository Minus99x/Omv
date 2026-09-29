import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const eth = fs.readFileSync(new URL('../public/chains/ethereum.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../src/core/recovery.js', import.meta.url), 'utf8');

test('test-only contact funding UI is owner-permission-gated and explicit', () => {
  assert.match(html, /Test-only contact gas funding/);
  assert.match(app, /fundTrustedContacts'\)\.disabled = !ownerAuthorized/);
  assert.match(app, /permissionHas\(currentVault\.owner\)/);
});

test('contact funding tops contacts up to a target using ordinary Sepolia wallet transfers', () => {
  assert.match(eth, /async topUpTestAccount/);
  assert.match(eth, /eth_sendTransaction/);
  assert.match(eth, /Test funding recipient is not a valid Ethereum address/);
  assert.match(eth, /currentWei >= targetWei/);
});

test('test-role authorization supports one permission grant instead of repeated disconnects', () => {
  assert.match(html, /Authorize test roles/);
  assert.match(app, /authorizeTestRoles/);
  assert.match(eth, /wallet_requestPermissions/);
  assert.match(app, /you no longer need to disconnect\/reconnect/i);
});

test('live contract actions can target an explicitly authorized signer', () => {
  assert.match(eth, /sendContractAction\(\{ contractAddress, artifact, signature, actor = null \}\)/);
  assert.match(app, /pendingTrustedContacts\(\)\.find\(permissionHas\)/);
  assert.match(app, /currentVault\.owner\) \? currentVault\.owner : permittedAccounts\[0\]/);
});

test('test-contact funding audit operation is owner-only', () => {
  assert.match(core, /test\.contact\.funded/);
  assert.match(core, /Only the configured owner may be recorded as funding a test contact/);
});
