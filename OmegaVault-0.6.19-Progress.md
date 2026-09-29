# OmegaVault 0.6.19-dev Progress

## Latest verified increment

- Added checked-in versioned-v0 transaction/message fixtures with deterministic SHA-256 evidence for both empty and populated address-table lookup vectors.
- Extended the RPC envelope parser across compiled-instruction arrays and v0 address-table lookup vectors instead of accepting bytes after the blockhash without structural validation.
- Enforced consistent header account counts, canonical compact-u16 arrays, complete static keys/blockhash/instructions/lookups and exact end-of-message consumption.
- Validated compiled instruction program/account indices against the combined static-plus-loaded account set.
- Added fail-closed coverage for unsupported versions, noncanonical signature counts, truncated v0 lookup counts, truncated lookup keys, out-of-range loaded-account references and oversized legacy/v0 packets.
- Other transaction versions remain explicitly unsupported rather than being silently interpreted as v0.

## Verification results

- Focused Solana suites: 35/35 passed.
- Full JavaScript suite: 208/208 passed.
- Full syntax/manifest check: passed.
- Solana source/codec evidence check: passed (`e140b5235505df36f727051adf880f78b8ff7168b4e0269fc2071d4d7f24804e`).

## Promotion boundary

This remains deterministic offline RPC-fixture coverage, not validator-backed integration or a live-network proof. SPL Token/Token-2022 remain unpromoted; no deployment, broadcast or wallet signature was performed. Rust/Agave/Solana SBF tooling is unavailable in this environment, so the existing native-SOL artifact remains the latest compiled execution proof.

## Next offline task

Decode and allowlist the exact compiled program IDs/instruction data expected in the recovery message so extra or reordered Compute Budget, ATA, token and recovery instructions fail closed; then mirror the reviewed path into Rust SBF when the pinned toolchain is available.
