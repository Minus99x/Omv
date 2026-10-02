# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.35-dev**

Archive filename: `omegavault-mvp-0.6.35-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.35-dev.checkpoint-manifest.json`

The archive SHA-256 is deliberately recorded only in the external sidecar manifest so the archive does not attempt to contain its own digest.

## 0.6.35 delta

- Added keyboard-focusable capability cards and semantic live-region status.
- Added backend-driven capability filters for all / promotion eligible / not promotion eligible.
- Added name/stage sorting that changes presentation only and does not recalculate maturity.
- Added visible evidence references for every gate row.
- Added operator summary counts sourced from backend eligibility flags.
- Unknown filter/sort values fail closed in the presentation selector.
- Preserves 0.6.34 rule that browser code never independently derives promotion eligibility.

## Verification

- Capability UI accessibility/operator tests: **12/12 passed**.
- Broad dependency-free offline regression: **233/233 passed**.
- `npm run check`: **passed**.
- Deterministic archive rebuild: **passed**.
- Fresh-extraction sidecar verification: **passed**.
- Nine SDK-bound test files remain intentionally workstation-gated until `npm ci` restores their pinned dependencies.

## Promotion boundary

No chain is newly promoted. Filtering and sorting are presentation-only operations over backend-validated contracts.

## Next offline gate

Add evidence-detail/API presentation that resolves visible evidence references into checkpoint/proof provenance without creating browser-side promotion logic. Continue operator diagnostics and accessibility hardening around evidence history.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
