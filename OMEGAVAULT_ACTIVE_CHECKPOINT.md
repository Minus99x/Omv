# OmegaVault Active Checkpoint

Current sealed development checkpoint: **0.6.49-dev**

Active checkpoint candidate: **0.6.50-dev**

Candidate branch: `dev/0.6.50-checkpoint-candidate`

## 0.6.50 candidate delta

- Registers the sealed 0.6.49 archive as explicit Stellar and Bitcoin execution-evidence provenance.
- Removes resolved dependency blockers for Stellar SDK and Bitcoin Noble execution.
- Raises Stellar to `offline-verified` while preserving all missing public-testnet/live gates.
- Keeps Bitcoin `reduced-semantics` and preserves the explicit no-covenant limitation.
- Adds a focused maturity/provenance verification lane.
- Corrects audit/API/UI tests so historical artifacts stay immutable while current state can legitimately advance.

## Candidate verification baseline

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Full suite: **433/433 passed**.
- Offline-resume: **16/16 + 11/11 passed; ok: true**.
- Global checks: **passed**.

## Promotion boundary

No connector is promoted by 0.6.50. This candidate only reconciles maturity/provenance metadata with evidence already sealed in 0.6.49.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
