# OmegaVault 0.6.48 Progress

## Completed

- Added explicit publisher-key trust configuration separate from detached signature authentication.
- Added digest-linked publisher trust history with enrollment, key rotation, revocation and current-head snapshots.
- Preserved an explicit authenticated-but-untrusted state for stale, rotated, revoked or identity-mismatched publisher keys.
- Enforced strict canonical schemas and no-authority boundaries on publisher trust events and snapshots.
- Added fail-closed `--require-trusted-publisher` behavior while retaining backward-compatible authenticated-only verification.
- Proved that publisher trust cannot override stale publication lineage.
- Hardened append-only reviewer trust, trust-policy anchor, publication and publisher-trust tooling against partial writes by preflighting all output destinations.
- Restored operator-audit API validation, HTTP routing and UI-backed response coverage.
- Added the reusable `test:review-audit` security suite.
- Added development-branch GitHub Actions verification with pinned Node/npm dependencies.

## Verification

- `npm ci`: passed.
- Focused review/audit suite: **84/84 passed**.
- Full dependency-backed suite: **415/415 passed**.
- `npm run verify:offline-resume`: **ok: true**.
- `npm run check`: passed.

## Security boundary

A valid publisher signature establishes cryptographic authentication only. Publisher trust requires separate current policy history. Neither publisher authentication nor publisher trust changes reviewer trust, anchoring-authority trust, chain maturity, evidence promotion, deployment authority, wallet authority or live-proof status.

## Process improvement

Dependency-backed clean-room verification is now available through GitHub Actions. This removes the old requirement to wait for a local workstation merely to run the pinned offline suite and makes future development checkpoints easier to verify continuously.

## Next priority

Continue the highest-value dependency-backed native execution evidence work:

1. Stellar native-recovery execution evidence.
2. Bitcoin finalizer execution evidence.
3. Re-run focused, full, offline-resume and global checks after each coherent gate.

No connector promotion is authorized by this checkpoint.
