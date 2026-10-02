# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.38-dev**

Archive filename: `omegavault-mvp-0.6.38-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.38-dev.checkpoint-manifest.json`

The archive SHA-256 is deliberately recorded only in the external sidecar manifest so the archive does not attempt to contain its own digest.

## 0.6.38 delta

- Added backend provenance-health and evidence-gap diagnostics for every chain in the capability catalog.
- Separates provenance integrity from promotion eligibility: a chain may have healthy provenance while still having missing gates or blockers.
- Reports unresolved refs, cross-wired refs, missing gates, insufficient-evidence gates and blockers independently.
- Adds explicit-lineage diagnostics with semantics `cryptographic-parent-bindings-only`.
- Version/timeline order is never treated as ancestry.
- A claimed lineage ref must resolve to provenance containing an explicit valid parent-bundle SHA-256; fabricated lineage fails closed.
- Added validated API envelope `omegavault.api.evidence-diagnostics.v1` at `/api/evidence-diagnostics`.
- Added browser diagnostics with all/error/gap/clear filters and presentation-only sorting.
- Browser diagnostics consume backend promotion state and never calculate readiness independently.

## Verification

- Evidence-diagnostics backend/API/browser/HTTP slice: **15/15 passed**.
- Broad dependency-free offline regression: **280/280 passed**.
- `npm run check`: **passed**.
- Full suite: **280 passed / 9 workstation-gated files failed to load**, exactly the known missing pinned SDK/toolchain boundary.

## Promotion boundary

No chain is newly promoted. Diagnostics describe provenance health and evidence gaps but do not change promotion eligibility.

## Next offline gate

Add explicit parent-bundle provenance metadata only where an actual cryptographic parent binding can be recovered from existing evidence, and add checkpoint/provenance integrity summaries suitable for export. Do not synthesize missing lineage.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
