# OmegaVault Multichain Execution Plan 0.6.9

## Priority order
- [x] Common chain-scoped asset identity model
- [x] Fail-closed production asset registry
- [ ] Verify/register USDC official identities by supported recovery chain
- [ ] Verify/register USDT official identities by supported recovery chain
- [ ] Verify/register TUSD identities only where current official documentation is sufficient
- [x] Verify/register RLUSD: Ethereum, Base, Optimism, XRPL
- [ ] Extend RLUSD to additional documented EVM networks already supported/added by OmegaVault
- [ ] Major wrapped/staked assets by chain
- [ ] Relevant high-ownership meme assets, with the same exact-identity gates
- [ ] Bitcoin executable descriptor/miniscript construction
- [ ] Bitcoin canonical PSBTv2 serialization/signature verification
- [ ] Cardano remaining offline tasks

## Safety invariant
An asset symbol/name is display metadata, never identity. Production token recovery requires exact chain + network + canonical contract/mint/issuer identity verified against an authoritative source.


## 0.6.9 asset registry update
- Verified USDT identities added for Ethereum, TRON, and Solana from Tether official integration guidance.
- Verified native USDC identities added for Ethereum, Base, Arbitrum, OP Mainnet, Polygon PoS, Avalanche C-Chain, XDC, Solana, Stellar, and XRPL from Circle official contract-address documentation.
- Bridged/lookalike assets remain ineligible unless separately and explicitly verified.
- Ethereum USDT records the SafeERC20 compatibility requirement for its legacy no-boolean transfer behavior.
- TUSD and meme-token identities remain pending authoritative identity verification.
