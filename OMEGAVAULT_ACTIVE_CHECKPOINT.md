# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.29-dev**

Authoritative archive: `omegavault-mvp-0.6.29-dev(1).zip`
SHA-256: `417cbcf443d10bd1e2b1238316b6eb8824aaac2a44dede84473a52447c989011`

## 0.6.29 delta

- Added fail-closed lockfile v3 inspection for exact direct versions, complete graph entries, HTTPS npm-registry tarballs and SHA-512 integrity metadata.
- Bound both package manifests and the 131-package graph summary to machine-readable dependency evidence.
- Added installed direct-dependency verification.
- Added a Node.js 22.12+ cross-platform resume workflow using `npm ci --ignore-scripts`, dependency verification, the full test suite and global checks.
- Updated the Windows launcher to use the same runtime and restore gates.
- Kept the detected Aiken lifecycle script explicit and suppressed during deterministic restore.

## Verification

- Focused dependency-integrity suite: **3/3 passed**.
- Full JavaScript suite: **238/238 passed**.
- Exact manifest and installed-tree verification: **passed**.
- `npm run check`: **passed**.
- Archive integrity test: **passed**.

## Promotion boundary

This checkpoint hardens offline build integrity only. It does not perform a deployment, transaction or wallet signature and does not promote any connector.

## Next offline gate

Advance Stellar native-recovery execution evidence with the restored pinned SDK, then strengthen Bitcoin Noble-backed finalizer and Bitcoin Core/Signet cross-check evidence. Solana SBF remains parked pending Rust/Agave.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
