# OmegaVault Multichain Execution Plan 0.6.35

## Immediate offline sequence

1. Keep backend capability contracts authoritative.
2. Keep browser filtering/sorting presentation-only.
3. Expose evidence references and blockers accessibly.
4. Add evidence-detail/API provenance presentation next.
5. Continue operator diagnostics without adding client-side maturity decisions.

## Workstation sequence

1. Run `npm ci`.
2. Run `npm run preflight:workstation`.
3. Run `npm run verify:offline-resume`.
4. Resume Stellar and Bitcoin cryptographic suites.
5. Restore additional SDK/toolchain suites as reported by preflight.

No live-chain action is part of this UI checkpoint.
