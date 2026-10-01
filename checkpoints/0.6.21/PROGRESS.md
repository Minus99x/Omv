# OmegaVault 0.6.21-dev — Solana token-sweep source checkpoint

The tag-4 Rust source is implemented but not compilation-proven in the current environment.

Key changes:
- post-recovery-only SPL Token / Token-2022 sweep
- canonical custody-PDA validation and PDA-signed `TransferChecked` CPI
- canonical rescue ATA derivation
- exact decimals/balance/frozen-state checks
- fail-closed Token-2022 extension handling
- required `ImmutableOwner` on Token-2022 rescue ATA
- wrapped SOL refusal from the generic token path
- one-lamport custody-PDA sentinel after native recovery
- frozen 0.6.17 source/build snapshots retained for old SBF provenance

Verification:
- Solana model 15/15
- Rust-source structural suite 4/4
- npm check PASS
- full JS 114/127; 13 startup failures are missing pinned packages only

Current archive:
`omegavault-mvp-0.6.21-dev.zip`
SHA-256:
`fd8d1d2b96c10231ee853e2e8e96cc25f92954cce70f8015b9221fa0f5ddf122`

Next gate: compile current Rust with pinned Rust 1.98.1 / Agave 4.3.0, then run native-sentinel and token positive/adversarial compiled-SBF program tests before any Devnet proof.
