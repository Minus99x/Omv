# OmegaVault 0.6.46 Progress

## Completed

- Added unsigned publication receipts for the exact current reviewer trust-policy anchor-history snapshot and head.
- Bound each receipt to the snapshot digest, entry count, head entry, head anchor, checkpoint, reviewer and trust-policy snapshot.
- Added optional detached Ed25519 publisher authentication without adding signing or private-key persistence to normal CLI tooling.
- Added create and verify CLIs with output-overwrite protection and explicit rejection of publisher secret inputs.
- Added fail-closed coverage for stale histories, rolled-back snapshots, substituted heads, publisher metadata tampering, mismatched keys/signatures and altered authority.
- Preserved strict separation from reviewer trust, anchoring-authority trust, chain maturity, evidence promotion, deployment authority and wallet authority.
- Removed a stale syntax-check reference to a nonexistent XRPL source file; runtime behavior was unchanged.

## Verification

- Focused review auditability slice: 36/36 passed.
- Dependency-free regression: 292/292 passed.
- Global checks: passed.
- Full discovery: 292 passed; 11 dependency-gated files could not load and 3 pre-existing operator-audit mismatches remain at the starting head.

## Security boundary

The base publication receipt remains unsigned. Detached publisher authentication proves only that one key authenticated one exact publication receipt; it grants no reviewer, anchoring, chain, evidence, deployment or wallet authority. No transaction, deployment, wallet signature or live-value action occurred.

## Next priority

Add append-only successor lineage for publication receipts so an older validly authenticated publication record cannot be replayed as the current publication head when current publication history is available.

