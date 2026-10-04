# OmegaVault Active Checkpoint

Current sealed development checkpoint: **0.6.51-dev**

Active checkpoint candidate: **0.6.52-dev**

Candidate branch: `dev/0.6.52-checkpoint-candidate`

## 0.6.52 candidate delta

- Registers the sealed 0.6.51 Cardano toolchain/evidence proof by exact archive SHA-256.
- Removes the obsolete "restore pinned Cardano/Aiken toolchain" blocker.
- Keeps Cardano at `offline-verified`.
- Adds offline address-validation evidence from the sealed applied Preprod fixture.
- Preserves synchronized Preprod Ogmios evaluation plus independent phase-1 validation at one acquired tip as unresolved.
- Preserves Preprod submission/finality, wallet signing and public-network recovery evidence as unresolved.
- Adds a dedicated Cardano maturity/provenance reconciliation gate.

## Candidate verification baseline

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Full suite: **437/437 passed**.
- Offline-resume: **16/16 + 11/11 passed; ok: true**.
- Global checks: **passed**.

## Promotion boundary

No connector is promoted by 0.6.52. The checkpoint reconciles Cardano's maturity/provenance metadata with evidence already sealed in 0.6.51.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
