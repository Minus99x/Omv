# Solana Native Program Build — 0.6.17

Official Solana and Anza documentation reviewed on 2026-09-28 remains the basis for PDA signing, CPI, Token Program/Token-2022 separation and the Agave tool line:

- https://solana.com/docs/core/pda
- https://solana.com/docs/core/cpi/cpi-with-pda
- https://solana.com/docs/tokens
- https://solana.com/docs/tokens/extensions
- https://docs.anza.xyz/cli/install
- https://github.com/anza-xyz/agave/releases

## Compiled execution result

Rust 1.98.1 and Agave CLI 4.3.0 compiled the pinned program to `artifacts/solana/omegavault_solana_recovery.so`. The versioned evidence binds the SBF artifact to its Rust source, Cargo manifest and lockfile, JavaScript client codec and adversarial program-test source.

Two `solana-program-test` scenarios loaded the compiled SBF artifact and covered every native instruction. They proved canonical PDA initialization, owner heartbeat and approval reset, time-gated trusted-contact approvals, unknown-contact refusal, threshold enforcement, immutable rescue enforcement, full custody-lamport movement and post-recovery mutation refusal.

## Promotion boundary

This is offline SBF execution evidence, not Devnet proof. SPL Token/Token-2022 execution, associated-token-account funding policy, extension-aware refusal paths, compute/rent/lifetime integration and finalized public-network evidence remain incomplete.
