# OmegaVault Multichain Execution Plan 0.6.41

## Immediate offline sequence

1. Seal the deterministic ZIP.
2. Generate/verify the checkpoint sidecar.
3. Generate/verify the external review index.
4. Generate/verify the portable review-bundle descriptor.
5. Distribute the four artifacts together for independent review.

## Workstation sequence

1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar and Bitcoin cryptographic suites.
5. Restore other SDK/toolchain-bound suites as reported by preflight.
