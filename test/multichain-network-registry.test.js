import test from 'node:test';
import assert from 'node:assert/strict';
import { getNetwork, listNetworks } from '../src/chains/network-registry.js';

test('network registry separates chain identity from environment identity', () => {
  assert.equal(getNetwork('ethereum:sepolia').chainIdHex, '0xaa36a7');
  assert.equal(getNetwork('xdc:apothem').chainIdDecimal, 51);
  assert.equal(getNetwork('base:sepolia').chainIdDecimal, 84532);
  assert.equal(getNetwork('arbitrum:sepolia').chainIdDecimal, 421614);
  assert.equal(getNetwork('polygon:amoy').chainIdDecimal, 80002);
  assert.equal(getNetwork('bsc:testnet').chainIdDecimal, 97);
  assert.equal(getNetwork('avalanche:fuji-c').chainIdDecimal, 43113);
});

test('non-EVM proof environments are represented independently', () => {
  for (const id of ['xrpl:testnet', 'solana:devnet', 'stellar:testnet', 'tron:shasta', 'bitcoin:signet', 'cardano:preprod']) {
    assert.ok(getNetwork(id), id);
  }
  assert.equal(getNetwork('stellar:testnet').networkPassphrase, 'Test SDF Network ; September 2015');
  assert.equal(getNetwork('tron:shasta').protocolChainIdDecimal, 2494104990);
});

test('registry can filter testnets by chain', () => {
  assert.equal(listNetworks({ chainId: 'ethereum', environment: 'testnet' }).length, 1);
  assert.equal(listNetworks({ chainId: 'stellar' })[0].id, 'stellar:testnet');
});
