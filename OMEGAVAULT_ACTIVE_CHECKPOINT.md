# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.40-dev**

Archive filename: `omegavault-mvp-0.6.40-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.40-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.40-dev.external-review-index.json`

The archive SHA-256 and external sidecar/index digests are intentionally recorded outside the archive after sealing, so the ZIP never attempts to contain its own hash.

## 0.6.40 delta

- Added deterministic `omegavault.operator-audit-index.v1` tying together the current provenance-audit SHA-256 and evidence-history SHA-256.
- Added backend/API/browser support for the operator audit index at `/api/operator-audit-index`.
- Added fail-closed validation for checkpoint drift, provenance-audit drift and evidence-history digest drift.
- Added `scripts/generate-external-review-index.js` / `npm run audit:review-index`.
- External review index generation occurs only after archive + checkpoint sidecar sealing.
- The external review index binds the exact archive filename/SHA-256, sidecar filename/file SHA-256, logical checkpoint-manifest SHA-256, source-tree SHA-256 and dependency-lock binding SHA-256.
- Verification semantics explicitly state `archiveSelfHashEmbedded: false` and preserve cryptographic-parent-only lineage authority.
- Browser review-index presentation remains read-only and cannot alter chain maturity or promotion state.

## Verification

- Operator/external review-index focused slice: **13/13 passed**.
- Broad dependency-free offline regression: **308/308 passed**.
- `npm run check`: **passed**.
- Full suite: **308 passed / 9 workstation-gated files failed to load**, exactly the known missing pinned SDK/toolchain boundary.

## Promotion boundary

No chain is newly promoted. Review-index metadata improves external auditability only.

## Next offline gate

Seal the deterministic ZIP, generate/verify the external checkpoint sidecar, then generate/verify the external review index against the sealed artifacts. After that, harden portable review bundles and machine-readable verification instructions for third-party review.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
