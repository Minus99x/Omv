# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.22-dev**

Archive: `omegavault-mvp-0.6.22-dev.zip`
SHA-256: `ac0a6ad15394b6f8fe12267330e9ef608f91127f8ed63181c65edb5035a98a19`

## 0.6.22 delta

- Shifted active multichain work away from the blocked Solana Rust/SBF toolchain and resumed XRPL hardening.
- Reverified current official XRPL Permission Delegation and multi-signing behavior.
- Added a minimal `DelegateSet(Payment)` builder for a dedicated recovery delegate with structural sequence/Ticket checks and explicit amendment/evidence expectations.
- Added a fail-closed delegated-recovery assessment. A dedicated delegate can use its own SignerList/quorum, reducing authority compared with putting recovery signers directly on the owner account.
- Encoded the native limitations: delegated Payment is not bound to owner-resettable inactivity, one rescue destination, one amount, or one currency.
- Added product-claim guards so permission delegation cannot be described as exact resettable-inactivity, immutable-rescue, destination-bound, amount-bound, or currency-bound recovery.
- Added a candidate XRPL plan combining `DelegateSet(Payment)` with a delegate-owned SignerList while preserving those limitations as blockers.
- Solana 0.6.21 remains preserved and parked until a usable Rust/Agave/SBF environment is available.

## Verification

- Focused XRPL native + permission-delegation suite: **16/16 passed**.
- `npm run check`: **passed**.
- Full JavaScript suite: **120 passed / 13 failed**.
- All 13 failures are the existing missing-dependency startup failures caused by absent pinned npm packages in the extracted workspace; no new functional assertion failure was observed.

## Security conclusion

XRPL Permission Delegation is a useful least-privilege support primitive, but it does not solve OmegaVault's exact inactivity or immutable-rescue requirements. Exact XRPL recovery remains unpromoted.

## Source of truth

The complete 0.6.22-dev archive is stored in the ChatGPT file Library under the exact filename and checksum above. Do not reconstruct the current source from the older tree on `main`.

## Next offline gate

Move to Bitcoin reduced-semantics/PSBT hardening and evidence unless a new XRPL-native primitive materially changes the exact-recovery analysis. Keep Solana frozen until the Agave/Rust workbench is available.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until the corresponding promotion gates pass.
