# OmegaVault Chain Assessment 0.6.12

## Cardano

The applied-parameter and transaction-body serialization gate now has reproducible offline evidence. Aiken 1.1.24 applies the one-shot seed and asset-name parameters, and Cardano Serialization Lib 17.0.0 independently reproduces the resulting Preprod-format recovery address. Four Conway transaction bodies serialize and byte-exact round-trip with the expected inline datum, validity, required-signer, collateral and beacon mint/burn fields.

The included seed is synthetic and expressly non-deployable. Body fees, collateral totals and script-data hashes are marked fixtures. Cardano therefore remains offline-only until live Preprod protocol parameters and cost models drive exact minimum ADA, execution-unit, fee, collateral, redeemer and witness calculations, followed by a public-network proof.

## Other chains

No existing connector status changed. Ethereum Sepolia remains the only completed public-network proof. Bitcoin remains reduced semantics; Stellar/TRON live proofs, XRPL exact codec work and Solana Rust execution remain pending as previously recorded.
