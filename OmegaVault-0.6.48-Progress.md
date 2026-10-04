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


## Post-seal multichain continuation

The development branch now extends the sealed 0.6.48 baseline with a substantial execution-evidence block. These changes are branch work until the exact current head completes the clean verification matrix.

### Stellar

- Completed the offline success-path execution pipeline from signed XDR through Horizon-normalized evidence.
- Added digest-bound evidence for applied failed recovery and one-time `preAuthTx` signer consumption.
- Added a failed-applied execution runner that rejects outer-hash substitution and signer-survival drift.
- Preserved the boundary that fixture/injected-driver evidence is not public Stellar Testnet proof.

### Bitcoin

- Added a Signet-only offline finalizer evidence gate for frozen canonical PSBTv2, CSV policy, contact threshold, descriptor binding, fee accounting and configured rescue output.
- Added a read-only Signet observation evidence layer for confirmation depth and exact rescue UTXO observation.
- Preserved `immutableRescueOnChain: false`; the finalizer checks the intended rescue destination but does not create a Bitcoin covenant.
- No transaction-construction/broadcast authority was added.

### TRON and EVM

- Added dedicated TRON recovery-runner tests for TRX/TRC-20 movement, deployment verification and solidification failure.
- Hardened the generic EVM native runner with unique-contact/reachable-threshold validation and exact rescue-balance delta checks.

### Cross-chain regression matrix

Added focused offline suites for XRPL, Solana, TRON, Cardano and EVM plus the existing Bitcoin/Stellar suites, and routed multichain evidence verifiers through global checks.

A catalog-level promotion-boundary test now asserts that no connector becomes promotion-eligible accidentally and that public-testnet-required gates cannot be satisfied by offline evidence alone.

### Genuine remaining gates

- Stellar: real public Testnet execution evidence.
- Bitcoin: real Signet execution/observation, Bitcoin Core final signed-transaction cross-check, and immutable-rescue semantic limitation.
- TRON: fresh Shasta deployment/recovery evidence.
- Cardano: actual Preprod evaluation/submission evidence; pinned Aiken verification is being re-exercised in the clean matrix.
- Solana: Rust/Agave rebuild plus Devnet execution evidence.
- XDC/Base/Arbitrum/Optimism/Polygon/BSC/Avalanche: their network-specific public-testnet recovery/finality evidence.
- XRPL: exact OmegaVault inactivity + immutable-rescue semantics remain protocol-limited under the current native mechanism.

No listed blocker may be cleared merely by documentation or offline fixtures.


### Solana SBF integrity

The new multichain re-audit exposed a historical SBF artifact/evidence digest mismatch. A dedicated status artifact now records the checked-in binary as `stale-untrusted` rather than blessing the observed hash. The Solana verifier now validates that fail-closed status and requires rebuild + SBF program-test + regenerated evidence before the connector can move beyond `parked`.
