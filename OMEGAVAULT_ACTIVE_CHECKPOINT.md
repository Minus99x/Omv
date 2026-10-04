# OmegaVault Active Checkpoint

Current sealed development checkpoint: **0.6.52-dev**

Active checkpoint candidate: **0.6.53-dev**

Candidate branch: `dev/0.6.53-checkpoint-candidate`

## 0.6.53 candidate delta

- Adds a deterministic Cardano Preprod evidence-capture plan around the existing zero-budget Ogmios evaluation candidate.
- Freezes action, transaction CBOR/body hash, JSON-RPC request id and expected redeemer pointers before live node interaction.
- Requires one acquired Preprod tip across UTxO state, protocol parameters, Ogmios evaluation and independent phase-1 validation.
- Normalizes node-returned execution units under current protocol limits and existing safety-margin rules.
- Produces deterministic, tamper-detectable synchronized-evaluation evidence.
- Keeps wallet signing, submission, live-value movement, inclusion/finality claims and connector promotion explicitly unauthorized.

## Candidate verification baseline

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Cardano Preprod evidence harness: **6/6 passed**.
- Full suite: **443/443 passed**.
- Offline-resume: **16/16 + 11/11 passed; ok: true**.
- Global checks: **passed**.

## Promotion boundary

0.6.53 prepares synchronized Preprod evidence capture only. No live Preprod request, wallet signature, transaction submission or public-network recovery proof is claimed.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
