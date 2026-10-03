# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.41-dev**

Archive filename: `omegavault-mvp-0.6.41-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.41-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.41-dev.external-review-index.json`
Portable review-bundle descriptor: `omegavault-mvp-0.6.41-dev.review-bundle.json`

External review metadata is generated only after the archive is sealed. The ZIP never embeds its own final SHA-256.

## 0.6.41 delta

- Added deterministic `omegavault.external-review-bundle.v1` descriptors.
- The descriptor binds the exact source ZIP, checkpoint sidecar and external review-index filenames, byte sizes and SHA-256 values.
- Logical sidecar and external review-index digests are cross-bound to the descriptor.
- Added explicit machine-readable verification rules for archive, sidecar, review-index and cross-binding checks.
- Added `npm run audit:review-bundle` and `npm run verify:review-bundle`.
- Verification fails closed if any external file hash, logical digest or checkpoint relationship drifts.
- Review-bundle semantics explicitly preserve `archiveSelfHashEmbedded: false`, backend-owned promotion authority and explicit-cryptographic-parent-only lineage authority.

## Verification

- Portable review-bundle focused slice: **5/5 passed**.
- Broad dependency-free offline regression: **313/313 passed**.
- `npm run check`: **passed**.
- Full suite: **313 passed / 9 workstation-gated files failed to load**, exactly the known missing pinned SDK/toolchain boundary.

## Promotion boundary

No chain is newly promoted. This checkpoint improves external verification portability only.

## Next offline gate

Seal the deterministic archive, generate and verify sidecar + external review index + portable review-bundle descriptor, then add a compact human-readable verification receipt derived from the machine-readable descriptor without creating a new source of truth.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
