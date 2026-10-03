# Reviewer Trust History — 0.6.43

The 0.6.43 checkpoint adds append-only reviewer-key trust lineage.

- `enroll` establishes the first public key.
- `rotate` requires a different key and binds the previous event digest and key fingerprint.
- `revoke` targets the active key and terminates the history.
- Only the current non-revoked key can confer reviewer trust.
- A history snapshot binds event count, current key, status and head digest to reject valid-prefix rollback.
- CLI tooling accepts public keys only and refuses to overwrite an existing output file.

These records authenticate review policy state only. They have no chain-promotion, evidence-promotion, deployment or wallet authority.
