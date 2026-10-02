# OmegaVault Multichain Execution Plan 0.6.31

## Immediate offline sequence
1. Seal each development checkpoint as an immutable deterministic ZIP.
2. Compute the ZIP SHA-256 only after archive completion.
3. Generate the external checkpoint-manifest sidecar.
4. Bind proof bundles to checkpoint/manifest identity.
5. Reject archive, dependency-lock or source-tree drift.
6. Continue shared capability/maturity metadata and API-contract hardening.

## Workstation sequence
1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar native-recovery cryptographic tests.
5. Resume Bitcoin Noble-backed descriptor/PSBT/finalizer tests.
6. Revisit Solana after Rust/Agave tooling is available.

All resume verification remains offline/read-only until a separate Captain-authorized public-network test is explicitly scheduled.
