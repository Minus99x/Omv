# OmegaVault Multichain Execution Plan 0.6.48

## Completed offline auditability work

- Reviewer identity/trust remains separate from receipt authentication.
- Reviewer-key and trust-policy-anchor successor histories are digest-linked.
- Publication receipts support detached publisher authentication without conflating authentication with trust.
- Publication receipt successor lineage enforces current-head status independently.
- Publisher-key trust now has separate enroll/rotate/revoke policy history and snapshots.
- Rotated, revoked and identity-mismatched publisher keys can remain cryptographically authenticated while being explicitly untrusted.
- Audit append CLIs preflight output targets before writing, preventing partial history artifacts.
- Operator-audit API/HTTP/UI consistency is restored.
- Dependency-backed GitHub Actions verification is operational.

## Verified baseline

- Focused review/audit suite: **84/84 passed**.
- Full dependency-backed suite: **415/415 passed**.
- Offline-resume verification: **ok: true**.
- Global checks: **passed**.

## Next safe work

1. Continue Stellar native-recovery execution evidence using the pinned dependency-backed verification lane.
2. Continue Bitcoin finalizer execution evidence after the Stellar gate is coherent and verified.
3. Keep all chain maturity/promotion labels evidence-based; no audit or trust metadata may promote a connector.
4. After each gate, run the focused relevant slice, full suite, offline-resume verification and global checks.

## Authority boundary

No work in this plan authorizes production deployment, mainnet/live-value transactions, wallet signatures, secret handling, chain promotion, deployment authority or wallet authority.

Local user interaction is reserved for steps that genuinely require the user's wallet, machine, credentials, signatures or explicit authorization—not routine dependency restoration or offline regression testing.


## Post-seal execution block

The branch has advanced beyond the original 0.6.48 plan without promoting any connector.

### Completed offline work

- Stellar success and failed-applied execution-evidence pipelines are implemented and digest-bound.
- Horizon transport/normalization and injected-driver orchestration are covered.
- Bitcoin now has an offline PSBTv2 finalizer-evidence gate and a read-only Signet observation-evidence layer.
- TRON recovery-runner orchestration has dedicated regression coverage.
- Generic EVM native recovery proof now validates approval-policy reachability and exact rescue-balance movement.
- A multichain offline verification matrix re-runs focused XRPL, Solana, TRON, Cardano, EVM and Bitcoin verification from global checks.
- Cross-chain promotion-boundary tests prevent offline evidence from satisfying public-testnet gates.

### Next execution order

1. Complete clean exact-head verification of the accumulated post-seal branch.
2. If the pinned Cardano/Aiken path is operational in the clean runner, remove only the obsolete toolchain portion of the Cardano blocker; otherwise record the exact toolchain failure and leave it blocked.
3. Preserve Stellar as `offline-verified` until a real public Testnet run populates the evidence pipeline.
4. Preserve Bitcoin as `reduced-semantics` until real Signet observation and the remaining final signed-transaction/Core cross-check are available; do not misrepresent the application-side rescue-output check as an on-chain covenant.
5. Continue network-specific public-testnet evidence for TRON/XDC/EVM compatibility chains when an authorized, non-secret execution lane exists.
6. Rebuild/retest the Solana native program with Rust/Agave before any Devnet promotion decision.
7. Keep XRPL reduced semantics unless a mechanism is found that independently enforces the missing inactivity and immutable-rescue properties.

## Checkpoint/version rule

The sealed 0.6.48 archive remains the last distributable checkpoint until package metadata, dependency lock, checkpoint manifest/review index and exact-head verification can be regenerated coherently. New branch work must not silently overwrite that archive identity.

## Authority boundary

No post-seal work authorizes production deployment, mainnet/live-value transactions, wallet signatures, secret handling, chain promotion, deployment authority or wallet authority.


### Solana integrity remediation

The multichain audit discovered that the checked-in SBF binary does not match the historical build-evidence digest. Its current state is recorded as a stale/untrusted SBF artifact, not as verified output. The remediation path is fixed: restore pinned Rust/Agave/cargo-build-sbf, rebuild from the bound source, rerun SBF program-test, regenerate build evidence, then obtain Devnet execution evidence. Do not update the historical digest merely to match the current binary.
