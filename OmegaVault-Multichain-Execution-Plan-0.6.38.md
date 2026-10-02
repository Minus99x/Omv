# OmegaVault Multichain Execution Plan 0.6.38

## Immediate offline sequence

1. Keep capability contracts as the sole promotion authority.
2. Keep provenance resolution and integrity diagnostics fail-closed.
3. Count only explicit cryptographic parent bindings as lineage.
4. Export provenance-health and gap summaries without changing maturity.
5. Recover actual parent-bundle metadata only where existing evidence proves it.

## Workstation sequence

1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar and Bitcoin cryptographic suites.
5. Restore other SDK/toolchain-bound suites as reported by preflight.
