# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.44-dev**

Archive filename: `omegavault-mvp-0.6.44-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.44-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.44-dev.review-index.json`

## 0.6.44 delta

- Added `omegavault.reviewer-trust-policy-anchor.v1` sidecars binding a trust-policy snapshot to one exact external review index.
- Anchor identity includes the review-index digest, checkpoint reference and archive digest.
- Receipt verification requires the receipt's review-index digest to equal the anchored external review index.
- Stale history/snapshot pairs, cross-checkpoint indexes, substituted indexes and tampered authority fail closed.
- Added public create/verify CLIs with output-overwrite protection and no private-key inputs.
- Policy anchors retain zero chain- or evidence-promotion authority and do not authenticate their named anchoring authority by themselves.

## Verification

- Focused reviewer trust-policy anchor and receipt-integration slice: **26/26 passed**.
- Broad dependency-free offline regression: **333/333 passed**.
- `npm run check`: **passed**; new anchor core and CLIs also passed explicit syntax checks.
- Full suite: **333 passed / 9 known workstation-gated files failed to load**.

## Promotion boundary

No chain is newly promoted. Reviewer trust-policy anchors remain audit metadata only and cannot satisfy chain promotion gates.

## Next offline gate

Add explicit predecessor lineage for successive policy anchors without inferring source ancestry.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
