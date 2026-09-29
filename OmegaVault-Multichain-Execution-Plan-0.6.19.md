# OmegaVault Multichain Execution Plan 0.6.19

## Completed in this increment

- [x] Reverify current Token-2022 extension behavior before changing recovery assumptions.
- [x] Replace blocklist-only extension gating with fail-closed allowlist gating.
- [x] Permit canonical Token-2022 ATA `ImmutableOwner` while refusing unreviewed mint/account extensions.
- [x] Add adversarial tests for unknown future extension names.
- [x] Preserve the distinction between known-danger extensions and unreviewed/unknown extensions in evidence output.
- [x] Parse raw Token-2022 mint/account TLV data client-side and reject malformed, duplicate, or unknown extension types before execution assessment.
- [x] Decode mint decimals plus token-account mint, authority, balance, and state from raw account bytes; reject caller-supplied metadata drift.

## Remaining ordered Solana token tasks

- [ ] Implement equivalent extension parsing and allowlist enforcement in Rust/SBF.
- [ ] Add SPL Token `TransferChecked` CPI from custody PDA authority.
- [ ] Add Token-2022 `TransferChecked` CPI for extension-safe mints/accounts.
- [ ] Define and execute canonical associated-token-account creation/funding behavior under program-test.
- [ ] Compile SBF and execute adversarial program-test coverage.
- [ ] Add compute-budget, rent, blockhash-expiry and finalized-commitment integration tests.
- [ ] Execute Devnet proof only after every offline gate passes.
