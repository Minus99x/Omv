# OmegaVault 0.6.10-dev Progress

## Concrete progress

- Added an executable Bitcoin P2WSH Miniscript descriptor compiler with secp256k1 point validation, descriptor checksums and network addresses.
- Added canonical BIP 370 PSBTv2 serialization/parsing, frozen transaction-intent enforcement, BIP 143 digest construction and cryptographic contact-threshold verification.
- Verified the deterministic descriptor in official Bitcoin Core 31.1 on Signet with network connections disabled.
- Verified private-key-disabled descriptor import, solvability, backup and restore.
- Restored the full dependency graph and added exact `@noble/curves` 2.4.0 cryptography dependency.

## Tests

- Full suite: 153/153 passed.
- `npm run check`: passed, including existing EVM and TRON artifact verification.
- `npm run check:bitcoin`: passed, including deterministic Bitcoin Core evidence and PSBTv2 fixture verification.
- `npm audit --omit=dev`: 0 vulnerabilities.

## Promotion status

- No connector was promoted to live-proof.
- Bitcoin remains reduced semantics because the delayed threshold script cannot enforce an immutable rescue destination.
- No wallet signatures or user setup were requested.
- GitHub repository discovery returned no accessible repositories; push remains blocked only by repository visibility/access.

## Next offline task

Cardano: install/pin the official Aiken/Cardano toolchain, compile the state-UTXO validator, emit a CIP-57 blueprint, and close state-beacon/minimum-ADA test gaps before any Preprod request.
