# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.46-dev**

Archive filename: `omegavault-mvp-0.6.46-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.46-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.46-dev.review-index.json`

## 0.6.46 delta

- Added unsigned publication-head receipts binding the exact verified anchor-history snapshot and head.
- Added optional detached Ed25519 publisher authentication scoped only to the publication receipt.
- Stale histories, rolled-back snapshots, substituted heads, publisher tampering, wrong keys and altered authority fail closed.
- Creation tooling refuses publisher private-key, secret-key, seed and key-output arguments and protects existing output.
- Publisher authentication remains separate from reviewer trust, anchoring-authority trust, chain maturity, evidence promotion, deployment authority and wallet authority.
- Removed one stale `npm run check` reference to a nonexistent XRPL source file; no XRPL behavior changed.

## Verification

- Focused review-receipt/trust/anchor/publication slice: **36/36 passed**.
- Broad dependency-free offline regression: **292/292 passed**.
- `npm run check`: **passed**.
- Full discovery: **292 passed / 11 dependency-gated files failed to load / 3 pre-existing operator-audit mismatches remain at the starting head**.

## Promotion boundary

No chain is newly promoted. Publication receipts remain audit metadata only and cannot satisfy trust, chain, deployment or wallet gates.

## Next offline gate

Add explicit successor lineage for independently authenticated publication receipts so an older valid publication record cannot be replayed as the current publication head when the current publication history is supplied.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
