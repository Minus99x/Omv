# OmegaVault 0.6.49 Progress

## Completed

### Stellar native-recovery execution evidence

- Added exact signed-envelope verification for the configured recovery-contact signature set.
- Added deterministic Stellar recovery execution evidence binding the pre-authorized transaction hash, exact signed XDR, pre-submission account snapshot, submission outcome and supplied finality observation.
- Added fail-closed coverage for missing/extra signatures, substituted transactions, account-policy drift, finality-hash substitution and applied transaction failure.
- Added a focused `test:stellar-recovery` verification lane.

### Bitcoin finalizer execution evidence

- Recovered the strict 0.6.23 PSBTv2 finalizer from the preserved Library archive `omegavault-mvp-0.6.23-dev.zip`.
- Verified the preserved archive SHA-256 exactly: `e2a96a522d3f921194f144b4b87276b540bf72bfb2da6bb2a48f6da3ff0f3e88`.
- Restored descriptor/P2WSH binding, block-based CSV enforcement, configured threshold/signers, caller-confirmed rescue output, exact fee, delayed recovery witness construction and raw SegWit extraction with txid/wtxid/weight/vsize.
- Executed the previously blocked Noble-backed cryptographic finalizer successfully.
- Added deterministic Bitcoin finalizer execution evidence binding the signed PSBT, descriptor policy, exact extracted transaction, fee, rescue output, CSV delay and selected recovery contacts.
- Added tamper-reproduction verification and a focused `test:bitcoin-recovery` lane.
- Preserved reduced semantics and explicit no-covenant/no-live-Signet-proof boundaries.

### Checkpoint hardening

- Raised the project version and lockfile root version to `0.6.49-dev`.
- Added a dedicated 0.6.49 checkpoint workflow.
- Built the checkpoint ZIP deterministically.
- Isolated generated artifacts outside the source tree so checkpoint-manifest/review-index verification cannot mutate the inventory it is validating.
- Generated and verified a fresh checkpoint manifest and external review index.
- Independently extracted the generated ZIP and reproduced the source inventory and review-index verification.

## Verification

- `npm ci`: **passed**.
- Focused review/audit suite: **84/84 passed**.
- Focused Stellar recovery suite: **20/20 passed**.
- Focused Bitcoin recovery suite: **22/22 passed**.
- Full dependency-backed suite: **432/432 passed**.
- `npm run verify:offline-resume`: **ok: true**.
- `npm run check`: **passed**.
- Checkpoint artifact generation and review verification: **passed**.

## Security and promotion boundary

No connector is newly promoted by 0.6.49.

Stellar evidence is an execution-evidence mechanism, not signing or deployment authority. Bitcoin finalizer evidence is offline, records no Signet broadcast/public-network proof, and does not convert the delayed threshold script into a covenant.

## Next priority

Begin post-0.6.49 work on a successor development branch. Choose the next chain-specific gap using the existing capability/maturity evidence and preserve the same focused/full/offline/global verification discipline.
