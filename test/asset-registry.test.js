import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_FAMILIES, VERIFIED_ASSET_IDENTITIES, getVerifiedAssetIdentity, createAssetCoverageRecord, assertProductionAssetIdentity } from '../src/core/asset-registry.js';
import { defineAsset } from '../src/core/assets.js';

test('coverage catalog includes requested stablecoin and broad-ownership classes', () => {
  for (const symbol of ['USDT','USDC','RLUSD','TUSD','WBTC','WETH','DOGE','SHIB','PEPE']) assert.ok(ASSET_FAMILIES[symbol]);
});

test('RLUSD official identities remain chain-scoped', () => {
  const eth = getVerifiedAssetIdentity({ economicAsset:'RLUSD', chainId:'ethereum', networkRef:'0x1' });
  const xrpl = getVerifiedAssetIdentity({ economicAsset:'RLUSD', chainId:'xrpl', networkRef:'xrpl:mainnet' });
  assert.ok(eth?.asset.identityVerified); assert.ok(xrpl?.asset.identityVerified); assert.notEqual(eth.asset.id, xrpl.asset.id);
});

test('production recovery refuses ticker-only or unverified token identity', () => {
  const fake = defineAsset({ chainId:'ethereum', networkRef:'0x1', kind:'fungible-token', assetRef:'0x1111111111111111111111111111111111111111', symbol:'USDT', identityVerified:true });
  assert.throws(() => assertProductionAssetIdentity(fake), /verified production registry/);
});

test('pending coverage cannot become production eligible by symbol alone', () => {
  const r = createAssetCoverageRecord({ economicAsset:'USDC', chainId:'solana', networkRef:'solana:mainnet-beta' });
  assert.equal(r.productionEligible, false);
});

test('verified registry has no duplicate canonical identities', () => {
  assert.equal(new Set(VERIFIED_ASSET_IDENTITIES.map(x=>x.asset.id)).size, VERIFIED_ASSET_IDENTITIES.length);
});

test('USDT production identities are exact and chain scoped', () => {
  const eth = getVerifiedAssetIdentity({ economicAsset:'USDT', chainId:'ethereum', networkRef:'0x1' });
  const tron = getVerifiedAssetIdentity({ economicAsset:'USDT', chainId:'tron', networkRef:'tron:mainnet' });
  const sol = getVerifiedAssetIdentity({ economicAsset:'USDT', chainId:'solana', networkRef:'solana:mainnet-beta' });
  assert.equal(eth?.asset.assetRef, '0xdac17f958d2ee523a2206206994597c13d831ec7');
  assert.equal(eth?.transferCompatibility, 'safe-erc20-nonstandard-return');
  assert.equal(tron?.asset.assetRef, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  assert.equal(sol?.asset.assetRef, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
});

test('Circle native USDC identities are exact across priority recovery chains', () => {
  const expected = [
    ['ethereum','0x1','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
    ['base','base:mainnet','0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
    ['arbitrum','arbitrum:mainnet','0xaf88d065e77c8cc2239327c5edb3a432268e5831'],
    ['optimism','optimism:mainnet','0x0b2c639c533813f4aa9d7837caf62653d097ff85'],
    ['polygon','polygon:mainnet','0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'],
    ['avalanche','avalanche:c-chain','0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'],
    ['xdc','xdc:mainnet','0xfa2958cb79b0491cc627c1557f441ef849ca8eb1'],
    ['solana','solana:mainnet-beta','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
    ['stellar','stellar:mainnet','USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'],
    ['xrpl','xrpl:mainnet','5553444300000000000000000000000000000000.rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE']
  ];
  for (const [chainId,networkRef,assetRef] of expected) {
    const entry = getVerifiedAssetIdentity({economicAsset:'USDC',chainId,networkRef});
    assert.equal(entry?.asset.assetRef, assetRef);
    assert.equal(entry?.representation, 'native-issuer');
  }
});

test('bridged or lookalike USDC cannot pass production identity by symbol', () => {
  const bridgedBase = defineAsset({ chainId:'base', networkRef:'base:mainnet', kind:'fungible-token', assetRef:'0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', symbol:'USDC', identityVerified:true });
  assert.throws(() => assertProductionAssetIdentity(bridgedBase), /verified production registry/);
});
