# OmegaVault 0.6.6-dev

- XRPL exact codec/signature gate remains blocked: `xrpl` package installation timed out; no crypto promotion claim.
- Advanced to the next offline chain task rather than stalling the roadmap.
- Re-verified Solana PDA/program/deployment assumptions against current official Solana documentation.
- Fixed Solana vault/PDA `vaultId` validation to enforce the protocol 32-byte per-seed limit by UTF-8 byte length.
- Hardened token recovery preflight with explicit token-account-kind checks and optional exact source/rescue authority binding.
- Added adversarial tests for overlong/multibyte PDA seeds, mint-account substitution, and wrong rescue authority.
- Solana focused suite: 8/8 pass. `npm run check`: pass.
- Full suite: 82/90 pass; 8 test-file failures are caused by missing `@stellar/stellar-sdk` in this extracted environment, not assertion failures.
- No live-proof promotion and no wallet/user setup requested.
