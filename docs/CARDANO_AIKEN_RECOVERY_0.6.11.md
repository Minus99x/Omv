# Cardano Aiken Recovery Offline Gate — 0.6.11

## Compiled implementation

- Aiken 1.1.24 (`v1.1.24+bacbeb3`), stdlib 4.0.0, Plutus V3.
- Parameterized recovery spending validator with `Heartbeat`, `Approve` and `Execute` redeemers.
- Parameterized one-shot state-beacon minting policy.
- Generated CIP-57 `plutus.json` with datum, redeemer and parameter schemas.
- Machine-verifiable source/blueprint evidence in `docs/evidence/CARDANO_AIKEN_1_1_24.json`.

## Enforced invariants

- Exactly one beacon-bearing state input identifies the active vault.
- Heartbeat requires the owner signature, preserves the exact state value, advances liveness from a finite POSIX validity lower bound and clears approvals.
- Approval is inactivity-gated, requires a configured contact signature and adds exactly one unique contact.
- Owner, immutable rescue address, contacts, threshold and inactivity duration cannot change in continuing transitions.
- Execute requires inactivity plus threshold, creates no continuing state output, burns exactly one beacon and pays the exact remaining protected value to the immutable rescue address.
- Fees and collateral must come from external inputs.

## Minimum ADA

OmegaVault implements the CIP-55 Babbage calculation `(160 + serializedOutputBytes) × coinsPerUTxOByte`. The storage parameter is intentionally supplied from current network protocol parameters rather than hardcoded. Exact output serialization and live Preprod parameter retrieval remain transaction-builder work.

## Promotion boundary

Compilation is not a Preprod proof. Parameter application, configured script-address derivation, exact transaction-body round trips, live protocol parameters, execution-unit estimation, collateral selection, finality evidence and public-network execution remain required before any wallet request or connector promotion.
