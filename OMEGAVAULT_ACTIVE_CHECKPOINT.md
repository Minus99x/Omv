# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.20-dev**

Archive: `omegavault-mvp-0.6.20-dev.zip`
SHA-256: `4a9a1d53cd88e24d3be5e543dac9fac5c174fca39f236f851c63976225d474e3`

## 0.6.20 delta

- Reverified current official Solana Token/Token-2022 CPI, `TransferChecked`, ATA and `ImmutableOwner` behavior.
- Resolved a multi-asset sequencing hazard before Rust/SBF token execution: native recovery is the one-way recovery activation; token movements are repeatable **post-recovery sweeps** to the already immutable rescue authority.
- Added client-model enforcement requiring recovered state, passing token preflight and checked-token safety gates, canonical custody-PDA source authority, immutable rescue destination and exact token-program identity.
- Froze the future OmegaVault token-sweep instruction envelope as tag `4` + u64 little-endian amount + mint decimals.
- Froze the downstream Token Program CPI payload as canonical `TransferChecked` tag `12` + the same amount/decimals.
- Existing native-SOL SBF execution proof remains unchanged; token SBF execution is not claimed.

## Verification

- `npm run check`: **passed**.
- Focused Solana recovery model suite: **13/13 passed**.
- Full JavaScript suite: **108 passed / 13 failed**.
- All 13 failures remain dependency-loading startup failures caused by unavailable pinned npm packages in the execution sandbox; no new functional assertion failure was observed.
- Rust/Agave compilation remains unavailable in the current execution environment.

## Source of truth

The complete 0.6.20-dev archive is stored in the ChatGPT file Library under the exact filename and checksum above. Do not reconstruct it from the older 0.5 tree on `main`.

## Next offline gate

Implement tag `4` in Rust/SBF with post-recovery-only semantics: parse SPL Token / Token-2022 state, mirror the fail-closed extension allowlist, verify the canonical rescue ATA, issue `TransferChecked` via `invoke_signed` with custody-PDA seeds, then compile and run adversarial `solana-program-test` coverage.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until the corresponding promotion gates pass.
