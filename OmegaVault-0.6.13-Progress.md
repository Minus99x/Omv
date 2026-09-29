# OmegaVault 0.6.13-dev Progress

## Concrete progress

- Captured a current Cardano Preprod epoch-316 protocol-parameter snapshot with tip and source provenance.
- Bound the complete 350-entry Plutus V3 cost model to SHA-256 evidence.
- Added exact-rational execution-fee calculations, size-fee calculations, execution-unit/max-size limits and ceiling collateral calculations.
- Enforced ADA-only collateral and the current maximum collateral-input count.
- Added exact fixture redeemers and script-data hashes for initialization, heartbeat, approval and execution.
- Built and byte-exact round-tripped Plutus V3 witness sets and unsigned transactions for all four flows.
- Added deterministic witness/transaction hashes and fees to machine-readable evidence.
- Preserved the live-construction block because the complete cost model has only one machine-readable source and execution units have not been independently evaluated by a synchronized node.

## Tests

- JavaScript suite: 170/170 passed.
- Aiken on-chain suite: 7/7 passed; zero warnings.
- Cardano compiler, applied-parameter, address, protocol-parameter, fee, script-data, witness and transaction evidence gates: passed.
- Existing Bitcoin, EVM and TRON verification gates: passed.
- Production dependency audit: zero vulnerabilities.

## Promotion status

- Cardano remains offline-only and is not Preprod live-proof.
- No wallet signatures, addresses or funding were requested.
- GitHub exposes no accessible repositories, so push remains blocked only by repository visibility/access.

## Next offline task

Obtain a second independent machine-readable full-cost-model snapshot and a synchronized Preprod transaction-evaluation endpoint. Require exact parameter agreement, replace fixture execution budgets with node results, add final key-witness sizing and fee/minimum-ADA convergence, then run adversarial ledger evaluation.
