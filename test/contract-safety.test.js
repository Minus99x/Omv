import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../contracts/OmegaVaultRecoveryVault.sol', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../contracts/manifest.json', import.meta.url), 'utf8'));

test('contract manifest source hash matches exact Solidity source', () => {
  const hash = crypto.createHash('sha256').update(Buffer.from(source)).digest('hex');
  assert.equal(hash, manifest.source.sha256);
  assert.equal(manifest.productionValueAllowed, false);
  assert.equal(manifest.network.chainIdHex, '0xaa36a7');
  assert.equal(manifest.adapterVersionNumber, 400);
});

test('proof contract contains no delegatecall, tx.origin, or selfdestruct', () => {
  assert.doesNotMatch(source, /\bdelegatecall\b/);
  assert.doesNotMatch(source, /\btx\.origin\b/);
  assert.doesNotMatch(source, /\bselfdestruct\b/);
});

test('executeRecovery applies recovered state before the external transfer', () => {
  const start = source.indexOf('function executeRecovery()');
  const end = source.indexOf('function secondsUntilEligible()', start);
  const body = source.slice(start, end);
  assert.ok(body.indexOf('recovered = true;') > -1);
  assert.ok(body.indexOf('rescueDestination.call') > -1);
  assert.ok(body.indexOf('recovered = true;') < body.indexOf('rescueDestination.call'));
});

test('recovery destination and policy-critical parameters remain immutable', () => {
  for (const declaration of [
    'address public immutable owner;',
    'address payable public immutable rescueDestination;',
    'uint64 public immutable inactivityPeriod;',
    'uint8 public immutable threshold;'
  ]) assert.match(source, new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
