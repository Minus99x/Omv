import test from 'node:test';
import assert from 'node:assert/strict';
import { defineAsset, canonicalAssetId } from '../src/core/assets.js';

test('native asset identity is chain + network scoped', () => {
  const asset = defineAsset({ chainId: 'ethereum', networkRef: '0xaa36a7', kind: 'native', symbol: 'ETH' });
  assert.equal(asset.id, 'ethereum:0xaa36a7:native');
  assert.equal(asset.identityVerified, false);
});

test('ERC-20 identity cannot collide across networks', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const a = defineAsset({ chainId: 'ethereum', networkRef: '0xaa36a7', kind: 'fungible-token', assetRef: address });
  const b = defineAsset({ chainId: 'ethereum', networkRef: '0x1', kind: 'fungible-token', assetRef: address });
  assert.notEqual(a.id, b.id);
  assert.equal(canonicalAssetId(a), a.id);
});

test('EVM fungible-token identity validates token address', () => {
  assert.throws(() => defineAsset({ chainId: 'ethereum', networkRef: '0xaa36a7', kind: 'fungible-token', assetRef: 'USDC' }), /20-byte address/);
});


test('EVM-family token normalization applies to L2 and sidechain adapters', () => {
  for (const chainId of ['base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'xdc']) {
    const asset = defineAsset({ chainId, networkRef: `${chainId}:test`, kind: 'fungible-token', assetRef: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    assert.equal(asset.assetRef, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  }
});
