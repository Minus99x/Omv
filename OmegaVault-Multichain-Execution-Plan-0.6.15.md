# OmegaVault Multichain Execution Plan 0.6.15

## Completed in this increment

- [x] Pin xrpl.js 4.6.0 as the exact XRPL offline codec.
- [x] Verify signer-specific multisigning preimages and cryptographic signatures.
- [x] Bind each public key to its declared signer account.
- [x] Canonically order signer entries by numeric AccountID.
- [x] Enforce multisign top-level field rules and exact binary round-trip.
- [x] Bind deterministic synthetic evidence to signing-preimage and transaction-blob hashes.
- [x] Add mutation, identity, ordering, quorum and fee adversarial tests.

## Remaining XRPL gate

- [ ] Keep public Testnet proof blocked until product scope accepts a fixed-time Escrow mode or an immediate SignerList quorum mode without claiming resettable inactivity.

## Next ordered offline tasks

- [ ] Install and pin a compatible Solana/Agave Rust toolchain.
- [ ] Implement executable Solana instructions and strict state/PDA/account validation.
- [ ] Implement native SOL and SPL Token/Token-2022 recovery paths with extension-aware tests.
- [ ] Add compute-budget, rent, lifetime and finalized-commitment integration tests before Devnet proof.

Cardano's independent synchronized-node evaluation remains blocked by external Preprod/Ogmios evidence and will resume when that evidence is available.
