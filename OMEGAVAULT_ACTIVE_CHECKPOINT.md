# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.19-dev**

Archive: `omegavault-mvp-0.6.19-dev.zip`
SHA-256: `964a279aa5c40082a5f8d2a274529a733a599f4c5798c222d0a891edf837f12f`

## 0.6.19 delta

- Closed a fail-closed gap in Solana Token-2022 recovery preflight.
- Extension handling is now allowlist-based rather than relying only on known blocked extensions.
- No Token-2022 mint extensions are execution-approved at this checkpoint.
- `ImmutableOwner` is the only approved Token-2022 token-account extension because canonical Token-2022 associated token accounts initialize it automatically.
- Unknown and unreviewed extension names are rejected.
- Existing native-SOL SBF execution proof remains unchanged.

## Verification

- `src/chains/solana/recovery-program.js` syntax check: passed.
- Focused Solana model suite: **11/11 passed**.
- Full JavaScript suite attempted: **106 passed / 13 failed**.
- All 13 failures are dependency-loading failures for unavailable packages: `@stellar/stellar-sdk`, `@noble/curves`, `@emurgo/cardano-serialization-lib-nodejs`, `bs58`, and `xrpl`.
- No new functional-test failure was introduced.
- Rust/Agave compilation is not claimed in the current execution environment.

## Source of truth

The complete 0.6.19-dev archive is stored in the ChatGPT file Library under the exact filename above. Do not reconstruct 0.6.19 from the older 0.5 repository tree.

## Next offline gate

Mirror the extension allowlist/fail-closed policy inside the Rust/SBF program, add checked SPL Token and Token-2022 CPI using the custody PDA authority, compile with the pinned Rust/Agave toolchain, and run adversarial `solana-program-test` coverage before any Devnet interaction.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until the corresponding promotion gates pass.
