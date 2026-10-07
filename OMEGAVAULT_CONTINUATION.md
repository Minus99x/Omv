# OmegaVault Continuation Ledger

## Current state

- Branch: `dev/0.6.41-review-receipts`
- Latest sealed checkpoint: `0.6.48-dev` at `eae5ea2cdff33c4b86978fa34f7349504bc1ff49`
- Live parent inspected for this block: `053d60173270b94273748472c649d9a984bb3491`
- First verified commit in this block: `8792d15ac28fd5815f680bbd9e349d707b93e2e4`
- Chain promotion change: none

## Completed in this block

- Reconstructed and hash-checked the complete 492-blob live branch tree before verification; stale scratch-only test files were excluded from repository evidence.
- Verified the live Solana stale-artifact guard: source evidence remains valid while the mismatched checked-in SBF artifact remains `stale-untrusted`, not live-submission-ready.
- Added deterministic Bitcoin PSBTv2 recovery transaction extraction in `src/chains/bitcoin/transaction-finalizer.js`.
- The extractor constructs the exact SegWit witness transaction, orders CHECKMULTISIG signatures by canonical descriptor key order, binds txid/wtxid, byte size, weight and virtual size, and emits digest-bound final-transaction evidence.
- Added fail-closed canonical descriptor reconstruction so a reordered or hand-crafted contact policy cannot create an invalid witness while appearing threshold-valid.
- Preserved explicit boundaries: no signing, no private keys, no broadcast, no Signet execution claim, no Bitcoin Core acceptance claim and no chain-promotion authority.
- Added `src/chains/bitcoin/core-cross-check.js`, a read-only Bitcoin Core adapter that binds the extracted raw-transaction SHA, txid/wtxid, size/weight/vsize, complete inputs/witnesses/outputs, pinned node identity and one exact `testmempoolaccept` result.
- Added a driver contract exposing only `getnetworkinfo`, `getblockchaininfo`, `decoderawtransaction` and `testmempoolaccept`-equivalent reads. It has no signing, wallet, broadcast or chain-promotion capability.
- Added fail-closed coverage for wrong network/version, txid substitution, witness substitution, output-value drift, rejected-mempool ambiguity and evidence tampering.
- Added `scripts/verify-bitcoin-core-cross-check.js` plus package wiring as a deterministic, non-secret observation import boundary. Imported JSON cannot claim authenticated RPC provenance and always leaves `bitcoinCoreCrossCheckProven: false`.
- The CLI rejects observation authority injection, substituted transactions, existing output targets, private-key/seed/wallet/RPC credential arguments and all broadcast/promotion authority.
- Hardened `src/chains/bitcoin/signet-evidence.js` so finality observations require valid digest-bound finalizer and final-transaction evidence, the exact extracted txid/wtxid/raw digest, and a Signet chain-tip snapshot that derives the claimed confirmation count.
- The read-only Signet runner now requires `readChainTip()` and rejects stale/replayed tips, tips predating inclusion, hash substitution and inconsistent confirmation arithmetic.

## Verification

- Live-parent Solana focused suite: **36/36 passed**.
- Live-parent full suite: **499/499 passed**.
- Bitcoin focused suite after extraction: **32/32 passed**.
- Bitcoin focused suite after the Core adapter: **38/38 passed**.
- Bitcoin focused suite after the import CLI: **41/41 passed**.
- Bitcoin focused suite after finality binding: **42/42 passed**.
- Post-change full dependency-backed suite: **515/515 passed**.
- Offline-resume verification: **ok: true** (Stellar **26/26**, Bitcoin **5/5**).
- Global multichain checks: **passed**, including Aiken **7/7** and Solana artifact status `stale-untrusted`.
- These are exact offline working-tree results; do not infer public-network proof from offline fixtures.

## Genuine blockers

- Solana: this runtime has no Rust/Agave/`cargo-build-sbf` toolchain, so the current source cannot be rebuilt into a trusted SBF artifact here.
- Bitcoin: no Bitcoin Core binary or live Signet node is available in this runtime. Bitcoin Core finalization/decoding acceptance and real Signet observation remain unproven.
- No wallet signatures, private keys, transaction broadcasts or public-network writes were requested or performed.

## Exact next objective

Extend the read-only Bitcoin Core acceptance evidence with exact fee diagnostics: bind Core's `testmempoolaccept.fees.base` to the deterministic input/output fee, reject effective-fee or vsize drift, and retain imported-vs-RPC provenance separation. After that, run the adapter against a pinned Bitcoin Core/Signet runtime when available; public Signet submission remains a separate user-authorized gate.
