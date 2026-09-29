# OmegaVault Chain Assessment 0.6.9

## Cross-chain assets
A shared economic asset may have multiple unrelated on-chain identities. OmegaVault now models these separately and forbids ticker-based production matching.

### Verified in registry
- RLUSD / Ethereum mainnet: official Ripple proxy contract.
- RLUSD / Base mainnet: official Ripple proxy contract.
- RLUSD / Optimism mainnet: official Ripple proxy contract.
- RLUSD / XRPL mainnet: official Ripple currency+issuer identity.

### Catalogued but not production-verified in this version
USDT, USDC, TUSD, WBTC, WETH, DOGE, SHIB, PEPE. Their presence records intended coverage only; it does not authorize recovery.

## Existing chain status
No connector promotion in 0.6.9. Bitcoin focused policy tests remain passing. XRPL exact crypto, Solana Rust execution, and clean full-suite dependency gates remain unresolved as previously recorded.


## 0.6.9 asset registry update
- Verified USDT identities added for Ethereum, TRON, and Solana from Tether official integration guidance.
- Verified native USDC identities added for Ethereum, Base, Arbitrum, OP Mainnet, Polygon PoS, Avalanche C-Chain, XDC, Solana, Stellar, and XRPL from Circle official contract-address documentation.
- Bridged/lookalike assets remain ineligible unless separately and explicitly verified.
- Ethereum USDT records the SafeERC20 compatibility requirement for its legacy no-boolean transfer behavior.
- TUSD and meme-token identities remain pending authoritative identity verification.
