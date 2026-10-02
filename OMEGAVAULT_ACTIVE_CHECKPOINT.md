# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.37-dev**

Archive filename: `omegavault-mvp-0.6.37-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.37-dev.checkpoint-manifest.json`

The archive SHA-256 is deliberately recorded only in the external sidecar manifest so the archive does not attempt to contain its own digest.

## 0.6.37 delta

- Added a backend evidence-checkpoint history catalog derived only from validated evidence provenance records.
- Groups maturity evidence by exact checkpoint/archive identity and reports refs, chains, scopes, summaries and artifact paths.
- Adds deterministic predecessor/successor links explicitly labeled `evidence-checkpoint-order-not-source-ancestry`.
- Added fail-closed API validation for timeline ordering, archive/provenance drift, summary-count drift and unsafe artifact paths.
- Added validated API envelope `omegavault.api.evidence-history.v1` at `/api/evidence-history`.
- Added browser evidence-history diagnostics with text search, chain filtering and newest/oldest ordering.
- Browser history remains presentation-only and contains no promotion-eligibility field or maturity inference.
- Missing or invalid history fails closed and cannot alter chain status.

## Verification

- Evidence-history backend/API/browser/HTTP slice: **17/17 passed**.
- Broad dependency-free offline regression: **265/265 passed**.
- `npm run check`: **passed**.
- Full suite: **265 passed / 9 workstation-gated files failed to load**, exactly the known missing pinned SDK/toolchain boundary.

## Promotion boundary

No chain is newly promoted. Evidence history is an operator diagnostic view only and does not establish source ancestry, proof parentage or promotion readiness.

## Next offline gate

Add stronger checkpoint lineage diagnostics using only explicit cryptographic parent/checkpoint bindings where available, plus operator provenance-health summaries and evidence-gap diagnostics. Do not infer ancestry from version order.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
