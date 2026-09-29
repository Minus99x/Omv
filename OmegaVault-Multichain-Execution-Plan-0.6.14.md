# OmegaVault Multichain Execution Plan 0.6.14

## Completed in this increment

- [x] Include deterministic synthetic key witnesses in final-size and fee convergence.
- [x] Verify output minimum ADA using serialized output sizes and current `coinsPerUtxoByte`.
- [x] Verify declared collateral covers the current percentage requirement.
- [x] Build zero-budget Ogmios evaluation candidates and bind transaction-body hashes/redeemer pointers to evidence.
- [x] Add adversarial evaluation-response tests for missing, duplicate, unexpected, zero and over-cap budgets.
- [x] Require one acquired node tip and separate phase-1 validation before accepting node evaluation.

## Remaining Cardano offline tasks

- [ ] Obtain a second independent machine-readable full-cost-model snapshot and require exact agreement.
- [ ] Evaluate all four zero-budget candidates through a synchronized Preprod node/Ogmios acquired state.
- [ ] Replace Aiken fixture budgets with accepted node results and rerun script-data hash, signed-size, fee, minimum-ADA, collateral and phase-1 convergence.
- [ ] Select a real Preprod seed UTxO and generate deployment-specific validators only after every offline gate passes.

## Parallel asset work

TUSD, major wrapped/staked assets and relevant high-ownership meme assets remain pending authoritative per-chain identity verification. Ticker-only recovery remains forbidden.
