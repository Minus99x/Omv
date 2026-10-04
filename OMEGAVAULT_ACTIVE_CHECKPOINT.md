# OmegaVault Active Checkpoint

Current sealed development checkpoint: **0.6.50-dev**

Active checkpoint candidate: **0.6.51-dev**

Candidate branch: `dev/0.6.51-checkpoint-candidate`

## 0.6.51 candidate delta

- Adds a clean CI proof of the existing pinned Cardano/Aiken toolchain.
- Executes Aiken 1.1.24 formatter, check/tests and build.
- Verifies the Cardano CIP-57 blueprint against source evidence.
- Verifies applied policy/address and four canonical transaction-body fixtures with CSL 17.0.0.
- Verifies signed-size, fee, minimum-ADA, collateral and zero-budget Ogmios evaluation-request evidence.
- Preserves the existing live-construction block; no Preprod node evaluation or submission is claimed.

## Candidate verification baseline

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano pinned toolchain/evidence lane: **passed**.
- Full suite: **433/433 passed**.
- Offline-resume: **16/16 + 11/11 passed; ok: true**.
- Global checks: **passed**.

## Promotion boundary

No connector is promoted by 0.6.51. Cardano remains offline-verified and live construction remains blocked pending synchronized Preprod evaluation/submission evidence.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
