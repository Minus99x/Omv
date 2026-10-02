# OmegaVault Multichain Execution Plan 0.6.37

## Immediate offline sequence

1. Keep backend capability contracts as the sole maturity authority.
2. Keep provenance records as the authority for evidence-ref checkpoint/archive identity.
3. Use evidence history only as operator diagnostics.
4. Distinguish version/timeline order from explicit cryptographic parent/checkpoint lineage.
5. Add provenance-health and evidence-gap diagnostics next.

## Workstation sequence

1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar native-recovery and Bitcoin cryptographic finalizer suites.
5. Restore other toolchain-bound suites as reported by preflight.

No live-chain action is part of this checkpoint.
