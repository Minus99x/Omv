# OmegaVault Chain Assessment 0.6.13

## Cardano

Cardano now has deterministic offline protocol-parameter, fee, collateral, redeemer, script-data-hash and witness-set machinery. The current Preprod epoch-316 scalar parameters are consistent with the public explorer view, while the complete Plutus V3 cost model is preserved from a machine-readable Koios snapshot. Each of the four OmegaVault flows produces byte-stable witness and unsigned-transaction CBOR.

This is not a live-ready connector. The full cost model has only one machine-readable source in the captured evidence, Aiken test execution units are not a substitute for evaluating the exact transaction through a synchronized node, and final key witnesses change transaction size. The promotion gate therefore remains closed until those items are independently resolved.

## Other chains

No existing connector status changed. Ethereum Sepolia remains the only completed public-network proof. Bitcoin remains reduced semantics; Stellar/TRON live proofs, XRPL exact codec work and Solana Rust execution remain pending.
