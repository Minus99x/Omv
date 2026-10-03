# OmegaVault Multichain Execution Plan 0.6.40

## Immediate offline sequence

1. Build the deterministic checkpoint ZIP.
2. Generate and verify the external checkpoint sidecar.
3. Generate the deterministic internal external-review basis.
4. Generate the external review index only after archive and sidecar identities exist.
5. Verify the review index against the actual ZIP, actual sidecar bytes and current internal review basis.
6. Keep review metadata separate from chain promotion authority.

## Workstation sequence

1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar and Bitcoin cryptographic suites.
5. Restore other SDK/toolchain-bound suites as reported by preflight.
