import { defineAsset } from './assets.js';

const STATUS = new Set(['verified-official','pending-official-verification','unsupported']);

function freezeEntry(entry) { return Object.freeze({ ...entry, aliases: Object.freeze([...(entry.aliases ?? [])]) }); }

export const ASSET_FAMILIES = Object.freeze({
  USDT: freezeEntry({ symbol:'USDT', name:'Tether USD', class:'stablecoin', priority:1, aliases:['USDt'] }),
  USDC: freezeEntry({ symbol:'USDC', name:'USD Coin', class:'stablecoin', priority:1, aliases:[] }),
  RLUSD: freezeEntry({ symbol:'RLUSD', name:'Ripple USD', class:'stablecoin', priority:1, aliases:[] }),
  TUSD: freezeEntry({ symbol:'TUSD', name:'TrueUSD', class:'stablecoin', priority:2, aliases:[] }),
  WBTC: freezeEntry({ symbol:'WBTC', name:'Wrapped Bitcoin', class:'wrapped-major', priority:2, aliases:[] }),
  WETH: freezeEntry({ symbol:'WETH', name:'Wrapped Ether', class:'wrapped-major', priority:2, aliases:[] }),
  DOGE: freezeEntry({ symbol:'DOGE', name:'Dogecoin', class:'major-meme-native', priority:3, aliases:[] }),
  SHIB: freezeEntry({ symbol:'SHIB', name:'Shiba Inu', class:'meme-token', priority:4, aliases:[] }),
  PEPE: freezeEntry({ symbol:'PEPE', name:'Pepe', class:'meme-token', priority:4, aliases:[] })
});

// Only identities verified from issuer/operator documentation belong here. Discovery by ticker is forbidden.
const VERIFIED = [
  { economicAsset:'USDT', chainId:'ethereum', networkRef:'0x1', kind:'fungible-token', assetRef:'0xdac17f958d2ee523a2206206994597c13d831ec7', decimals:6, identityVerified:true, identitySource:'Tether official Supported Protocols', status:'verified-official', transferCompatibility:'safe-erc20-nonstandard-return' },
  { economicAsset:'USDT', chainId:'tron', networkRef:'tron:mainnet', kind:'fungible-token', assetRef:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals:6, identityVerified:true, identitySource:'Tether official Supported Protocols', status:'verified-official' },
  { economicAsset:'USDT', chainId:'solana', networkRef:'solana:mainnet-beta', kind:'fungible-token', assetRef:'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals:6, identityVerified:true, identitySource:'Tether official Supported Protocols', status:'verified-official' },
  { economicAsset:'USDC', chainId:'ethereum', networkRef:'0x1', kind:'fungible-token', assetRef:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals:6, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'base', networkRef:'base:mainnet', kind:'fungible-token', assetRef:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals:6, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'arbitrum', networkRef:'arbitrum:mainnet', kind:'fungible-token', assetRef:'0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals:6, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'optimism', networkRef:'optimism:mainnet', kind:'fungible-token', assetRef:'0x0b2c639c533813f4aa9d7837caf62653d097ff85', decimals:6, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'polygon', networkRef:'polygon:mainnet', kind:'fungible-token', assetRef:'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', decimals:6, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'avalanche', networkRef:'avalanche:c-chain', kind:'fungible-token', assetRef:'0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', decimals:6, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'xdc', networkRef:'xdc:mainnet', kind:'fungible-token', assetRef:'0xfa2958cb79b0491cc627c1557f441ef849ca8eb1', decimals:6, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'solana', networkRef:'solana:mainnet-beta', kind:'fungible-token', assetRef:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals:6, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'stellar', networkRef:'stellar:mainnet', kind:'fungible-token', assetRef:'USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', decimals:7, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'USDC', chainId:'xrpl', networkRef:'xrpl:mainnet', kind:'fungible-token', assetRef:'5553444300000000000000000000000000000000.rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE', decimals:null, identityVerified:true, identitySource:'Circle official USDC contract addresses', status:'verified-official', representation:'native-issuer' },
  { economicAsset:'RLUSD', chainId:'ethereum', networkRef:'0x1', kind:'fungible-token', assetRef:'0x8292bb45bf1ee4d140127049757c2e0ff06317ed', decimals:18, identityVerified:true, identitySource:'Ripple official token-address documentation', status:'verified-official' },
  { economicAsset:'RLUSD', chainId:'base', networkRef:'base:mainnet', kind:'fungible-token', assetRef:'0x8d58c0c60b8d6b88fa98b291a646db34d0f98258', identityVerified:true, identitySource:'Ripple official token-address documentation', status:'verified-official' },
  { economicAsset:'RLUSD', chainId:'optimism', networkRef:'optimism:mainnet', kind:'fungible-token', assetRef:'0x8d58c0c60b8d6b88fa98b291a646db34d0f98258', identityVerified:true, identitySource:'Ripple official token-address documentation', status:'verified-official' },
  { economicAsset:'RLUSD', chainId:'xrpl', networkRef:'xrpl:mainnet', kind:'fungible-token', assetRef:'524C555344000000000000000000000000000000:rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', identityVerified:true, identitySource:'Ripple official XRPL RLUSD documentation', status:'verified-official' }
].map(entry => Object.freeze({ ...entry, asset: defineAsset({ ...entry, symbol: entry.economicAsset }) }));

export const VERIFIED_ASSET_IDENTITIES = Object.freeze(VERIFIED);

export function getVerifiedAssetIdentity({ economicAsset, chainId, networkRef }) {
  return VERIFIED.find(x => x.economicAsset === economicAsset && x.chainId === chainId && x.networkRef === networkRef) ?? null;
}

export function createAssetCoverageRecord({ economicAsset, chainId, networkRef, status='pending-official-verification', note=null }) {
  if (!ASSET_FAMILIES[economicAsset]) throw new TypeError('Unknown economic asset family.');
  if (!STATUS.has(status)) throw new TypeError('Invalid asset coverage status.');
  return Object.freeze({ economicAsset, chainId, networkRef, status, note, productionEligible: status === 'verified-official' && !!getVerifiedAssetIdentity({economicAsset,chainId,networkRef}) });
}

export function assertProductionAssetIdentity(asset) {
  if (!asset?.identityVerified) throw new TypeError('Production token recovery requires an officially verified asset identity.');
  const match = VERIFIED.find(x => x.asset.id === asset.id);
  if (!match) throw new TypeError('Token identity is not in the verified production registry.');
  return match;
}
