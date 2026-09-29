# OmegaVault Chain Assessment 0.6.14

## Cardano

The offline builder now includes exact key-witness sizing, iterative fee convergence, serialized-output minimum-ADA checks, collateral sufficiency checks and deterministic zero-budget Ogmios evaluation candidates. Evaluation responses fail closed unless every expected redeemer is returned exactly once and margin-adjusted totals remain below current protocol caps.

Ogmios evaluation is deliberately not treated as complete ledger validation because it may omit authentication and does not execute all phase-1 rules. Cardano remains offline-only until the full cost model has independent confirmation and the exact candidates are evaluated and phase-1 validated against one synchronized Preprod acquired state.

## Other chains

No connector promotion changed. Ethereum Sepolia remains the only completed public-network proof. Bitcoin retains reduced semantics; Stellar/TRON public proofs, XRPL pinned codec verification and Solana Rust execution remain pending.
