# OmegaVault Multichain Execution Plan 0.6.19

## Completed in this increment

- [x] Reverify current Token-2022 extension behavior before changing recovery assumptions.
- [x] Replace blocklist-only extension gating with fail-closed allowlist gating.
- [x] Permit canonical Token-2022 ATA `ImmutableOwner` while refusing unreviewed mint/account extensions.
- [x] Add adversarial tests for unknown future extension names.
- [x] Preserve the distinction between known-danger extensions and unreviewed/unknown extensions in evidence output.
- [x] Parse raw Token-2022 mint/account TLV data client-side and reject malformed, duplicate, or unknown extension types before execution assessment.
- [x] Decode mint decimals plus token-account mint, authority, balance, and state from raw account bytes; reject caller-supplied metadata drift.
- [x] Freeze a digest-bound `TransferChecked` instruction plan from a passing raw-account assessment, including exact account roles and PDA signer intent.
- [x] Derive the rescue associated-token-account PDA from owner, token-program ID, and mint; reject caller-asserted canonicality and bind assessed account addresses into `TransferChecked`.
- [x] Freeze a digest-bound `CreateIdempotent` rescue-ATA plan with exact funding/account roles and mandatory post-creation raw-data verification.
- [x] Bind ATA creation, finalized post-creation account evidence, raw safety assessment, and `TransferChecked` into a tamper-evident two-phase recovery coordinator.

## Remaining ordered Solana token tasks

- [ ] Implement equivalent extension parsing and allowlist enforcement in Rust/SBF.
- [ ] Add SPL Token `TransferChecked` CPI from custody PDA authority.
- [ ] Add Token-2022 `TransferChecked` CPI for extension-safe mints/accounts.
- [ ] Execute canonical associated-token-account creation/funding under program-test and verify the post-creation account snapshot.
- [ ] Compile SBF and execute adversarial program-test coverage.
- [ ] Add compute-budget, rent, blockhash-expiry and finalized-commitment integration tests.
- [ ] Execute Devnet proof only after every offline gate passes.
