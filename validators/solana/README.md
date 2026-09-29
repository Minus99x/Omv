# OmegaVault Solana recovery program

Native Rust source for the version-1 state-PDA and custody-PDA recovery path. Instruction tags are `0` initialize, `1` heartbeat, `2` approve and `3` execute native SOL recovery.

The crate pins `solana-program` 5.1.0 and `solana-system-interface` 3.3.0. Rust 1.98.1 and Agave CLI 4.3.0 compile the program to SBF. The retained Cargo lockfile, artifact and source hashes plus compiled-SBF `solana-program-test` scenarios provide the offline native-SOL execution evidence. SPL/Token-2022 instructions, compute/rent/lifetime integration and Devnet proof remain promotion gates.

The current native path enforces program-owned canonical state/custody PDAs, immutable rescue destination, owner-only heartbeat, inactivity-gated trusted-contact bitmap approvals, threshold execution, and full custody-lamport movement to the stored rescue account. Initialization explicitly claims safely prefunded System-owned PDAs instead of accepting the predictable-address denial-of-service exposure of a create-only path.
