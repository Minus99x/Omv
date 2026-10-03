# OmegaVault Multichain Execution Plan 0.6.40

## Immediate offline sequence

1. Seal the deterministic 0.6.40 ZIP.
2. Generate and verify the external checkpoint sidecar.
3. Generate the external review index from the sealed ZIP + sidecar.
4. Verify archive, sidecar, operator audit index and review-index digests fail closed on drift.
5. Keep external review metadata separate from the archive where self-reference would otherwise occur.

## Workstation sequence

1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar and Bitcoin cryptographic suites.
5. Restore other SDK/toolchain-bound suites as reported by preflight.
