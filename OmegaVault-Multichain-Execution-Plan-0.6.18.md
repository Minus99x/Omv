# OmegaVault Multichain Execution Plan 0.6.17

## Completed in this increment

- [x] Install isolated Rust 1.98.1 and Agave CLI 4.3.0 toolchains.
- [x] Generate and retain the Cargo lockfile.
- [x] Apply canonical Rust formatting and compile the Solana program to SBF.
- [x] Bind source, manifest, lockfile, client-codec, test-source and SBF artifact hashes to versioned evidence.
- [x] Execute the compiled SBF artifact in `solana-program-test` for initialization, heartbeat, contact approval and native SOL recovery.
- [x] Verify inactivity, membership, threshold, immutable rescue, custody movement, heartbeat reset and recovered-state refusal paths.

## Remaining ordered Solana tasks

- [ ] Implement SPL Token recovery using checked mint decimals and explicit token-account authority validation.
- [ ] Implement Token-2022 extension-aware preflight and refusal paths for transfer fees, default-frozen accounts, required memos, permanent delegates, non-transferable assets and confidential transfers.
- [ ] Define associated-token-account creation/funding policy and prove it under program-test.
- [ ] Add compute-budget, rent, blockhash-expiry and finalized-commitment integration tests.
- [ ] Execute Devnet proof only after every offline gate passes.

## 0.6.18 next Solana token gate

- [x] Exact checked-decimal preflight.
- [x] Source balance / frozen-state fail-closed preflight.
- [x] Canonical rescue ATA requirement represented explicitly.
- [x] Token-2022 risky extension classes fail closed in the client model.
- [ ] Implement equivalent extension parsing and enforcement in Rust/SBF.
- [ ] Add SPL Token TransferChecked CPI from custody PDA authority.
- [ ] Add Token-2022 TransferChecked CPI for extension-safe mints/accounts.
- [ ] Compile SBF and execute adversarial program-test coverage.
- [ ] Only after all offline gates pass, prepare Devnet evidence; do not request wallet signatures before then.
