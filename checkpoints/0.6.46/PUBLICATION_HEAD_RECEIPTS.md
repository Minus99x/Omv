# Publication-Head Receipts — 0.6.46

The 0.6.46 checkpoint binds an independently controlled publication record to the exact current reviewer trust-policy anchor-history snapshot and head.

- The base receipt is digest-bound and explicitly unsigned.
- The receipt binds the history snapshot digest, entry count, head entry, head anchor, checkpoint, reviewer and current trust-policy snapshot.
- Optional Ed25519 publisher authentication is detached and authenticates only the exact publication receipt.
- The creation CLI accepts no private-key material, rejects secret/key-output flags and refuses output overwrite.
- Verification fails closed for stale or rolled-back histories, substituted heads, tampered publisher metadata, wrong public keys, mismatched signatures and altered authority.
- Neither the base receipt nor its detached authentication grants reviewer trust, anchoring-authority trust, chain maturity, evidence promotion, deployment authority or wallet authority.

The next gate is append-only publication-receipt successor lineage to make valid older publication records distinguishable from the current publication head when current publication history is supplied.
