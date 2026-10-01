# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.21-dev**

Archive: `omegavault-mvp-0.6.21-dev.zip`
SHA-256: `fd8d1d2b96c10231ee853e2e8e96cc25f92954cce70f8015b9221fa0f5ddf122`

## 0.6.21 delta

- Implemented OmegaVault Solana instruction tag `4` in the current Rust source as a post-recovery SPL Token / Token-2022 sweep path.
- Added on-chain source checks for recovered state, canonical custody PDA, exact token-program identity, matching mint/account owners, exact decimals, source balance, thawed accounts and canonical rescue ATA.
- Token-2022 remains fail-closed: no mint extensions are approved; source accounts allow at most `ImmutableOwner`; the canonical rescue ATA must contain exactly `ImmutableOwner`.
- Generic token recovery rejects wrapped/native SOL.
- Native recovery now retains a one-lamport custody-PDA sentinel so the PDA remains available as the authority for later token sweeps.
- Preserved exact 0.6.17 source/build/test snapshots separately so the historic compiled native-SOL artifact remains attributable to the inputs that produced it.
- The downstream CPI is canonical `TransferChecked` and is authorized with custody-PDA seeds via `invoke_signed`.

## Verification

- Focused Solana recovery model: **15/15 passed**.
- Current Rust token-source structural tests: **4/4 passed**.
- `npm run check`: **passed**.
- Full JavaScript suite: **114 passed / 13 failed**.
- All 13 failures are the existing missing-dependency startup failures; no new functional assertion failure was observed.
- Current Rust/SBF compilation is **not** claimed because Rust/Cargo/Agave are unavailable in the present execution environment.

## Provenance boundary

The 0.6.17 SBF artifact remains evidence for the frozen 0.6.17 source only. The current 0.6.21 Rust source is newer and must be freshly compiled and program-tested before it is called execution-proven.

## Source of truth

The complete 0.6.21-dev archive is stored in the ChatGPT file Library under the exact filename and checksum above. Do not reconstruct 0.6.21 from the older tree on `main`.

## Next offline gate

Restore the pinned Rust 1.98.1 / Agave 4.3.0 toolchain; compile the current source; exercise the updated native-sentinel behavior; add positive and adversarial SPL Token / Token-2022 `solana-program-test` coverage; build SBF; then hash-bind the current source, lockfile, tests and artifact.

If that toolchain is unavailable, immediately continue another independent OmegaVault hardening task rather than terminating the run.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until the corresponding promotion gates pass.
