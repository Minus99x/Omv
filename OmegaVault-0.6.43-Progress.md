# OmegaVault 0.6.43 Progress

## Completed

- Added append-only reviewer-key trust events for enrollment, rotation and terminal revocation.
- Bound every transition to the prior event digest and prior public-key fingerprint.
- Added current-key resolution so old rotated keys authenticate signatures without regaining trust.
- Added history snapshots that detect valid-prefix rollback by binding event count and head digest.
- Added public-key-only history append CLI and receipt-verification CLI support.
- Added ephemeral Ed25519 tests for rotation, revocation, wrong identity, tampering, reordering, skipped sequences and rollback.

## Security boundary

- No reviewer private key is created, read or persisted by normal tooling.
- A valid signature is not reviewer trust.
- Reviewer trust is not chain maturity, execution evidence or promotion authority.
- No deployment, transaction, wallet signature or live-value action occurred.

## Remaining gate

Independently anchor the current reviewer trust-policy snapshot so a stale but internally valid snapshot cannot be substituted without detection.
