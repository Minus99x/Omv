# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.47-dev**

Archive filename: `omegavault-mvp-0.6.47-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.47-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.47-dev.review-index.json`

## 0.6.47 delta

- Added digest-linked successor history for publication-head receipts.
- Each entry binds the exact predecessor entry and publication-receipt digest.
- Added a current-head snapshot binding the publisher, receipt, anchor-history head and checkpoint.
- Verification rejects an older valid publication receipt even when it advertises the same valid anchor head and carries a valid detached signature.
- Rollback, reorder, skipped links, duplicate receipts, publisher changes, non-increasing timestamps, authority changes and non-canonical extra fields fail closed.
- Publication-history tooling refuses secret inputs and protects existing output.

## Verification

- Focused review-receipt/trust/anchor/publication slice: **44/44 passed**.
- Broad dependency-free offline regression: **351/351 passed**.
- `npm run check`: **passed**.
- Full discovery: **351 passed / 9 dependency-gated files failed to load**.

## Promotion boundary

No chain is newly promoted. Publication lineage remains audit metadata only and cannot satisfy publisher trust, reviewer trust, anchoring-authority trust, chain, deployment or wallet gates.

## Next offline gate

Add separately configured publisher-key trust metadata/history so cryptographic publisher authentication is never confused with publisher identity approval or trust.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
