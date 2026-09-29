# Solana offline hardening — 0.6.6-dev

Status: offline scaffold only. No Devnet live-proof claim.

Verified assumptions encoded in this increment:

1. PDA seed components are limited to 32 bytes; `vaultId` is checked by UTF-8 byte length.
2. PDAs have no private keys and program signing is runtime-mediated.
3. Program mutable state remains in separate accounts.
4. Token recovery preflight must distinguish token accounts from mint accounts and bind mint, token program, source authority, and rescue authority.
5. Program promotion requires deployed bytecode/build provenance plus explicit upgrade-authority policy.

Toolchain blocker: `cargo`, `rustc`, and `solana` CLI are absent, so the Rust source remains a non-executable design scaffold.
