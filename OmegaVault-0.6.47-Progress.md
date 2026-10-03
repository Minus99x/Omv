# OmegaVault 0.6.47 Progress

## Completed

- Added append-only successor lineage for publication-head receipts.
- Bound each lineage entry to the exact prior entry and prior publication receipt.
- Added a digest-bound current-head snapshot covering publisher, receipt, anchor-history head and checkpoint.
- Integrated current-publication enforcement into publication-receipt verification.
- Preserved detached Ed25519 authentication while rejecting an authenticated-but-stale receipt.
- Added fail-closed canonical-field validation for receipts, detached signatures, lineage entries and lineage snapshots.
- Added public append/verify CLIs with overwrite protection and explicit secret-input refusal.

## Verification

- Focused review auditability slice: 44/44 passed.
- Dependency-free regression: 351/351 passed.
- Global checks: passed.
- Full discovery: 351 passed; 9 dependency-gated files could not load.

## Security boundary

Publication lineage establishes ordering and current-head integrity only. A valid signature authenticates the exact receipt but does not approve or trust the publisher. Neither mechanism changes reviewer trust, anchoring-authority trust, chain maturity, evidence promotion, deployment authority, wallet authority or live-proof status.

## Next priority

Add separately controlled publisher-key trust metadata and digest-linked rotation/revocation history while retaining the authenticated-but-untrusted state.
