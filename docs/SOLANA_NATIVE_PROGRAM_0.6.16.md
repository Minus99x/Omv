# Solana Native Program Source — 0.6.16

Official documentation was rechecked on 2026-09-28 before encoding the native program assumptions:

- Solana PDA model and program-only signing: https://solana.com/docs/core/pda
- Canonical bump derivation: https://solana.com/docs/core/pda/pda-derivation
- CPI with PDA signer seeds: https://solana.com/docs/core/cpi/cpi-with-pda
- Token Program and Token-2022 transfer/account distinction: https://solana.com/docs/tokens and https://solana.com/docs/tokens/extensions
- Agave CLI installation/release line: https://docs.anza.xyz/cli/install and https://github.com/anza-xyz/agave/releases

## Implemented source path

The native Rust processor defines four exact instruction tags: initialize (`0`), heartbeat (`1`), approve (`2`) and execute native SOL recovery (`3`). The fixed 642-byte state records canonical state/custody bumps, owner, immutable rescue, liveness time, inactivity duration, threshold, trusted contacts, approval bitmap and the exact vault-id seed.

Initialization creates program-owned state and custody PDAs through signed System Program invocations. Heartbeat requires the stored owner and resets all approvals. Approval requires elapsed inactivity and a configured signer. Execution rechecks the state/custody PDAs, threshold and immutable rescue before marking recovered and moving all custody lamports.

The crate pins current `solana-program` 5.1.0 and `solana-system-interface` 3.3.0. Because official System Program documentation warns that create-only initialization of predictable addresses can be denied by prefunding, initialization handles both zero-balance creation and safe allocation/assignment of an already prefunded, empty, System-owned PDA.

## Evidence boundary

Pinned Node dependencies derive the same deterministic fixture PDAs and exact initialization bytes recorded in `docs/evidence/SOLANA_PROGRAM_SOURCE_0.6.16.json`. Source hashes are verified by `npm run check:solana`.

This is source-level and codec-level evidence only. The environment lacks Rust, Cargo and Agave/Solana executables, so no SBF compilation, program-test execution, artifact hash or Devnet claim is made.
