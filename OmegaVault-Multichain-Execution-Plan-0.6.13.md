# OmegaVault Multichain Execution Plan 0.6.13

## Completed in this increment

- [x] Capture and validate current Preprod epoch/tip/protocol-parameter evidence.
- [x] Bind the complete Plutus V3 cost model to a deterministic digest.
- [x] Calculate size and execution fees with exact arithmetic and enforce current execution-unit/transaction-size limits.
- [x] Calculate ceiling collateral and enforce ADA-only/current input-count rules.
- [x] Construct exact fixture redeemers and script-data hashes for all four Cardano flows.
- [x] Byte-exact round-trip Plutus V3 witness sets and unsigned transactions.
- [x] Refuse live construction while full parameter provenance and node evaluation remain incomplete.

## Remaining Cardano offline tasks

- [ ] Obtain a second independent machine-readable full-cost-model snapshot and require exact agreement.
- [ ] Evaluate each exact transaction through a synchronized Preprod node/Ogmios endpoint.
- [ ] Replace Aiken fixture budgets with node evaluation results.
- [ ] Add final key-witness sizing, fee/minimum-ADA convergence and adversarial ledger-evaluation tests.
- [ ] Select a real seed UTxO and generate deployment-specific validators only after the offline gate closes.

## Parallel asset work

TUSD, major wrapped/staked assets and relevant high-ownership meme assets remain pending authoritative per-chain identity verification. Ticker-only recovery remains forbidden.
