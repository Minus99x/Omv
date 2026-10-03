# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.41-dev**

Archive filename: `omegavault-mvp-0.6.41-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.41-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.41-dev.review-index.json`

## 0.6.41 delta

- Added `omegavault.external-review-receipt.v1`, which binds a reviewer result to one exact external review-index digest.
- Supported outcomes are `verified`, `verified-with-notes`, and `rejected`.
- Review receipts explicitly have no chain-promotion or evidence-promotion authority.
- Base receipts are always unsigned; signatures are separate detached objects.
- Added `omegavault.external-review-receipt-signature.v1` with Ed25519 verification over the receipt SHA-256.
- Detached signatures authenticate only the receipt and explicitly have no promotion authority.
- No signing keys are created or persisted by normal receipt tooling.
- Added `npm run review:receipt` to create an unsigned receipt from an external review index.
- Wrong keys, changed receipts, tampered authority fields, missing public keys and invalid signatures fail closed.

## Verification

- Review receipt/signature/CLI focused slice: **6/6 passed**.
- Broad dependency-free offline regression: **313/313 passed**.
- `npm run check`: **passed**.
- Full suite: **313 passed / 9 known workstation-gated files failed to load**.

## Promotion boundary

No chain is newly promoted. A review receipt records an external review result only; even a valid cryptographic signature cannot promote a chain.

## Next offline gate

Add detached-signature file CLI verification and reviewer-key trust metadata that distinguishes cryptographic authentication from reviewer identity/trust. Never equate a valid key signature with an approved or trusted reviewer unless that trust is separately configured.

## Workstation gate

Run `npm ci` then `npm run verify:offline-resume` when a workstation is available.

## Safety boundary

Never modify `main` directly or perform production/live-value actions from this development queue.
