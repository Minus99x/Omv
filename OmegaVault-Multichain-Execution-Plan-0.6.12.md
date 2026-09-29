# OmegaVault Multichain Execution Plan 0.6.12

## Completed in this increment

- [x] Apply deterministic synthetic fixture parameters to the Cardano beacon and recovery validators.
- [x] Derive and independently verify the resulting policy id, script hash and Preprod-format enterprise addresses.
- [x] Encode the exact `VaultDatum` Plutus-data shape.
- [x] Build and byte-exact round-trip initialization, heartbeat, approval and execute Conway transaction-body CBOR.
- [x] Bind applied blueprints, compiled code and transaction-body hashes to machine-readable evidence.
- [x] Preserve an explicit non-deployable marker on the synthetic fixture.

## Remaining Cardano offline tasks

- [ ] Query current Preprod protocol parameters and cost models from independent sources.
- [ ] Replace fixture fee/minimum-ADA/collateral values with exact calculations.
- [ ] Build exact redeemers, compute real script-data hashes and evaluate execution units.
- [ ] Build and round-trip witness sets and add ledger-evaluation/adversarial transaction tests.
- [ ] Select a real seed UTxO, regenerate deployment-specific applied validators, and run Preprod proof only after every offline gate passes.

## Parallel asset work

TUSD, major wrapped/staked assets and relevant high-ownership meme assets remain pending authoritative per-chain identity verification. Ticker-only recovery remains forbidden.
