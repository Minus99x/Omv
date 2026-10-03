# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.40-dev**

Archive filename: `omegavault-mvp-0.6.40-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.40-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.40-dev.review-index.json`

The archive's own SHA-256 is deliberately not embedded inside the archive. External checkpoint identity is carried by the checkpoint sidecar, and the external review index binds that sidecar to the internal audit/history/provenance review basis.

## 0.6.40 delta

- Added deterministic `omegavault.external-review-basis.v1` binding the current provenance audit SHA-256, evidence-history SHA-256, evidence-provenance SHA-256 and review semantics.
- Added validated API envelope `omegavault.api.external-review-basis.v1` at `/api/review-basis`.
- Added `omegavault.external-review-index.v1`, generated only after the archive and checkpoint sidecar exist.
- The external review index binds the exact archive filename/SHA-256, checkpoint-sidecar file SHA-256 and logical SHA-256, source-tree digest, dependency-lock digest, provenance-audit digest, evidence-history digest and evidence-provenance digest.
- Added `npm run review:index` to generate the external review index.
- Added `npm run review:verify` to independently verify the ZIP, checkpoint sidecar and current internal review basis.
- Swapped archives, altered sidecars, stale audit/history state and tampered review-index fields fail closed.
- Review metadata explicitly states that archive identity comes from the external checkpoint sidecar and that version/timeline order does not establish source ancestry.

## Verification

- External review basis/index/API/CLI focused slice: **12/12 passed**.
- Broad dependency-free offline regression: **307/307 passed**.
- `npm run check`: **passed**.
- Full suite: **307 passed / 9 workstation-gated files failed to load**, exactly the known missing pinned SDK/toolchain boundary.

## Promotion boundary

No chain is newly promoted. External-review metadata is audit infrastructure only and cannot change chain maturity.

## Next offline gate

Add a signed-or-detached review receipt format that can record an external review result without granting that receipt authority over chain promotion. Keep signatures optional and never claim authenticity without a real signing key/signature.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
