import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES } from '../src/chains/adapter-interface.js';
import { getChain, listChains } from '../src/chains/registry.js';

const expected = ['ethereum', 'xrpl', 'solana', 'bitcoin', 'xdc', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'tron', 'stellar', 'cardano'];

test('all planned chain adapters are registered through one neutral contract', () => {
  const listed = listChains();
  assert.deepEqual(listed.map(x => x.id).sort(), [...expected].sort());
  for (const id of expected) {
    const adapter = getChain(id);
    assert.ok(adapter);
    assert.ok(adapter.accountModel);
    assert.ok(adapter.transactionModel);
    assert.ok(adapter.signingModel);
    assert.ok(adapter.recoveryMechanism);
    assert.ok(['live-proof', 'scaffold', 'planned'].includes(adapter.implementationStage));
    for (const capability of adapter.capabilities) assert.ok(CAPABILITIES.includes(capability));
  }
});

test('non-EVM adapters do not inherit Ethereum transaction/signing models', () => {
  const eth = getChain('ethereum');
  for (const id of ['xrpl', 'solana', 'bitcoin', 'tron', 'stellar', 'cardano']) {
    const adapter = getChain(id);
    assert.notEqual(adapter.transactionModel, eth.transactionModel);
    assert.notEqual(adapter.signingModel, eth.signingModel);
    assert.notEqual(adapter.family, 'evm');
  }
});

test('XDC remains a distinct adapter despite EVM-compatible address shape', () => {
  const eth = getChain('ethereum');
  const xdc = getChain('xdc');
  assert.notEqual(xdc.id, eth.id);
  assert.notEqual(xdc.family, eth.family);
  assert.match(xdc.securityNotes.join(' '), /does not imply shared chain behavior/i);
});

test('only Ethereum is marked as a live proof connector in the current baseline', () => {
  assert.equal(getChain('ethereum').implementationStage, 'live-proof');
  for (const id of expected.filter(id => id !== 'ethereum')) {
    assert.equal(getChain(id).implementationStage, 'scaffold');
    assert.equal(getChain(id).proofAdapter, false);
  }
});
