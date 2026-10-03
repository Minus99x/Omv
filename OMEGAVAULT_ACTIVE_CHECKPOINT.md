# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.45-dev**

Archive filename: `omegavault-mvp-0.6.45-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.45-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.45-dev.review-index.json`

## 0.6.45 delta

- Added append-only `omegavault.reviewer-trust-policy-anchor-history-entry.v1` records.
- Every entry binds the exact prior entry digest and prior policy-anchor digest.
- Added a head snapshot binding entry count, current anchor, checkpoint and trust-policy snapshot.
- Receipt verification can require the supplied anchor to be the current lineage head.
- Valid-prefix rollback, reordered/skipped lineage, duplicates, reviewer changes and non-increasing timestamps fail closed.
- Public append/verify CLIs refuse output overwrite and accept no private-key material.

## Verification

- Focused review-receipt/trust/anchor slice: **31/31 passed**.
- Broad dependency-free offline regression: **338/338 passed**.
- `npm run check`: **passed**.
- Full suite: **338 passed / 9 known workstation-gated files failed to load**.

## Promotion boundary

No chain is newly promoted. Anchor lineage remains audit metadata only and cannot satisfy chain promotion gates.

## Next offline gate

Bind an independently controlled publication receipt to the current anchor-history snapshot so repository-history access alone cannot silently replace the advertised lineage head.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
