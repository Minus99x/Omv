# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.28-dev**

Authoritative archive: `omegavault-mvp-0.6.28-dev(2).zip`
SHA-256: `e9e1aadaaf3a0561c374b75bcfd8ddbff39fc07425487111e33e5976ac3ea819`

## 0.6.28 delta

- Added network-specific finality evidence verification for Ethereum Sepolia and XDC Apothem.
- Bound exact RPC request/result shapes for chain identity, recovery receipt, receipt-block hash lookup, receipt-height canonical lookup and the `finalized` head.
- Bound finality evidence to the exact proof transaction, proof binding, common proof context and verified deployment digest.
- Required separate native and ERC-20 finality records and rejected cross-wired evidence.
- Restored pinned dependencies from the lockfile and completed the full regression suite.

## Verification

- Focused finality suite: **5/5 passed**.
- EVM/finality regression slice: **16/16 passed**.
- Full JavaScript suite: **235/235 passed**.
- `npm run check`: **passed**.
- Archive integrity test: **passed**.

## Promotion boundary

This checkpoint closes an offline implementation gate only. It does not contain fresh Ethereum Sepolia or XDC Apothem transactions and does not promote XDC to live-proof.

## Next offline gate

Harden dependency/lockfile integrity and workstation-resume tooling. Then continue independent Stellar and Bitcoin execution work while Solana SBF remains parked pending Rust/Agave.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
