# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.42-dev**

Archive filename: `omegavault-mvp-0.6.42-dev.zip`
Sidecar filename: `omegavault-mvp-0.6.42-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.42-dev.external-review-index.json`
Portable review-bundle descriptor: `omegavault-mvp-0.6.42-dev.review-bundle.json`
Human-readable verification receipt: `omegavault-mvp-0.6.42-dev.review-receipt.txt`

The receipt is generated deterministically from the machine-readable review bundle and is not a separate source of truth.

## 0.6.42 delta

- Added deterministic `omegavault.review-verification-receipt.v1` records derived exclusively from the external review-bundle descriptor.
- Added compact human-readable receipt rendering with checkpoint, file hashes, audit/history/source-tree/dependency-lock bindings, and verification status.
- Receipt explicitly records `Cryptographic signature: not-recorded` and `Reviewer attestation: not-recorded` unless real attestations exist.
- Added `npm run audit:review-receipt` and `npm run verify:review-receipt`.
- Receipt verification regenerates the expected text from the review-bundle descriptor and requires byte-for-byte equality.
- Receipt semantics explicitly state that it is not a source of truth and cannot affect chain maturity or promotion.

## Verification

- Review-receipt focused slice: **5/5 passed**.
- Broad dependency-free offline regression: **318/318 passed**.
- `npm run check`: **passed**.
- Full suite: **318 passed / 9 workstation-gated files failed to load**, exactly the known missing pinned SDK/toolchain boundary.

## Promotion boundary

No chain is newly promoted. This checkpoint improves human-readable reviewability only.

## Next offline gate

Seal the deterministic review package, generate/verify the receipt, then add optional attestation schema placeholders that remain unsigned until a real authorized signer explicitly signs a review package.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
