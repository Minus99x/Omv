# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.29-dev**

Authoritative archive: `omegavault-mvp-0.6.29-dev.zip`
SHA-256: `80ad4ceecb8645601928c132c0ad0e4b52a9faa38d552fca41b87f656b39cd9a`

## 0.6.29 delta

- Added an exact dependency/lockfile integrity verifier.
- Top-level runtime and dev dependencies must use exact semver pins.
- Root package-lock pins must match package.json exactly.
- Locked top-level packages must resolve to the exact pinned version and include valid SHA-512 integrity values.
- package.json and package-lock.json are SHA-256 bound into one dependency-lock manifest.
- Added a read-only workstation-resume preflight that inventories installed/missing/mismatched packages and Node/npm/Rust/Cargo/Solana/Aiken/bitcoin-cli availability.
- Added deterministic `npm ci` recommendation logic.
- The preflight performs no wallet, signature, deployment, transaction or chain-state action.

## Verification

- Dependency/workstation suite: **5/5 passed**.
- Combined Cardano/evidence/EVM-XDC/finality/TRON/preflight/dependency regression slice: **51/51 passed**.
- `npm run check`: **passed**.
- Existing Solidity and TRON artifact verification: **passed**.

## Current stripped-workspace result

The lockfile is internally valid and all expected versions/integrity hashes are present. The current stripped workspace lacks the pinned Node packages, so the preflight correctly recommends `npm ci` rather than misclassifying missing dependencies as chain-code failures.

## Promotion boundary

No chain maturity is promoted by this checkpoint.

## Source of truth

The complete 0.6.29-dev archive is stored in ChatGPT Library under the exact filename and checksum above.

## Next offline gate

Bind chain-proof bundles to the exact OmegaVault archive/checkpoint digest and add a one-command post-`npm ci` verification sequence for Stellar native recovery and the Bitcoin Noble-backed finalizer suite without performing live-chain actions.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
