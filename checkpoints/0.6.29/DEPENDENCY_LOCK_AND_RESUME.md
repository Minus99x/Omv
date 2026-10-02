# OmegaVault 0.6.29-dev — Dependency lock and resume integrity

Archive: `omegavault-mvp-0.6.29-dev(1).zip`

SHA-256: `417cbcf443d10bd1e2b1238316b6eb8824aaac2a44dede84473a52447c989011`

## Evidence boundary

- `package.json` SHA-256: `c1dc5e5a962e51aad6f7316b27a16479c226b4d99ac092ef099becfeddcae437`
- `package-lock.json` SHA-256: `9e5895bd11dc9ab77615779f67c6c6615874003284335aceee93e10ce3f27b12`
- Lockfile format: version 3
- Locked package entries: 131
- Exact direct dependencies: 7
- Lifecycle-script packages: `@aiken-lang/aiken` only

The machine-readable binding is `docs/evidence/DEPENDENCY_LOCK_0.6.29.json`.

## Resume contract

`npm run resume:workstation` requires Node.js 22.12+, restores the exact lockfile with lifecycle scripts suppressed, verifies the installed direct dependency versions, runs the full JavaScript suite, and runs global syntax/dependency/artifact checks. It performs no deployment, transaction, or wallet operation.

## Verification

- Dependency-integrity tests: 3/3 passed.
- Full JavaScript regression: 238/238 passed.
- Global check: passed.
- Installed dependency tree: matched all exact direct versions.

## Promotion boundary

This is offline build-integrity evidence only. It does not alter any chain connector's promotion state or replace required public-network evidence.

## Handoff

Next: advance Stellar native-recovery execution evidence using the restored pinned SDK, followed by Bitcoin Noble-backed finalizer and Bitcoin Core/Signet cross-check evidence. Solana remains parked pending Rust/Agave.
