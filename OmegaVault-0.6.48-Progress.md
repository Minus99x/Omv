# OmegaVault 0.6.48 Progress

## Sealed 0.6.48 baseline

The sealed 0.6.48-dev archive/checkpoint remains the publisher-trust and auditability checkpoint. Its original verification baseline was:

- Focused review/audit suite: **84/84 passed**.
- Full dependency-backed suite: **415/415 passed**.
- Offline-resume verification: **ok: true**.
- Global checks: **passed**.

The sealed archive is not retroactively rewritten by the continuation work below.

## Post-0.6.48 verified continuation

### Stellar native-recovery execution evidence

- Added exact signed-envelope verification for the configured recovery-contact signature set.
- Added deterministic Stellar recovery execution evidence binding the pre-authorized transaction hash, exact signed XDR, pre-submission account snapshot, submission outcome and supplied Stellar finality observation.
- Added fail-closed coverage for missing/extra signatures, substituted transactions, account-policy drift, finality-hash substitution and applied transaction failure.
- Added a focused `test:stellar-recovery` verification lane.
- Preserved the authority boundary: evidence creation does not authorize signing, submission, deployment, wallet authority or connector promotion.

### Bitcoin finalizer execution evidence

- Recovered the strict 0.6.23 PSBTv2 finalizer from the preserved Library archive `omegavault-mvp-0.6.23-dev.zip`.
- Verified the preserved archive SHA-256 exactly: `e2a96a522d3f921194f144b4b87276b540bf72bfb2da6bb2a48f6da3ff0f3e88`.
- Restored descriptor/P2WSH binding, block-based CSV enforcement, configured threshold/signers, caller-confirmed rescue output, exact fee, delayed recovery witness construction and raw SegWit extraction with txid/wtxid/weight/vsize.
- The previously blocked Noble-backed cryptographic finalizer now executes successfully in the pinned dependency lane.
- Added deterministic Bitcoin finalizer execution evidence binding the signed PSBT, descriptor policy, exact extracted transaction, fee, rescue output, CSV delay and selected contact signers.
- Evidence verification reproduces finalization and rejects tampering.
- Added a focused `test:bitcoin-recovery` lane.
- Preserved reduced semantics: OmegaVault binds the transaction it finalizes to the caller-confirmed rescue output, but ordinary Bitcoin Script does **not** create an immutable rescue covenant.

## Current verification

Clean GitHub Actions verification on the post-0.6.48 working head:

- `npm ci`: **passed**.
- Focused review/audit suite: **84/84 passed**.
- Focused Stellar recovery suite: **20/20 passed**.
- Focused Bitcoin recovery suite: **22/22 passed**.
- Full dependency-backed suite: **432/432 passed**.
- Offline-resume verification: **ok: true**, including **16/16** Stellar/offline checks and **11/11** Bitcoin recovery checks.
- Global `npm run check`: **passed**.

## Security and promotion boundary

No connector is newly promoted by this continuation.

Stellar evidence does not itself prove that a public-network submission occurred unless separately supplied and independently validated. Bitcoin finalizer evidence is explicitly offline and records `publicNetworkProof: false` and `broadcastObserved: false`. Bitcoin remains reduced-semantics because its delayed threshold script is not a covenant.

## Next checkpoint task

Promote this verified working head into a new **0.6.49-dev checkpoint candidate**. Generate fresh source-tree/checkpoint/provenance bindings for that candidate rather than modifying the already-sealed 0.6.48 archive.
