# OmegaVault Multichain Execution Plan 0.6.34

## Immediate offline sequence

1. Treat the backend capability/evidence contract as the single source of maturity truth.
2. Render validated capability state in the browser without re-deriving eligibility.
3. Fail closed if API validation or contract shape is unavailable.
4. Improve accessibility and operator diagnostics around blockers/evidence levels.
5. Continue evidence-detail/API presentation work.

## Workstation sequence

1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar native-recovery cryptographic tests.
5. Resume Bitcoin Noble-backed cryptographic finalizer tests.
6. Restore other pinned SDK/toolchain suites as reported by preflight.

No live-chain action is part of this UI checkpoint.
