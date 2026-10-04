# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.53-dev**

Archive filename: `omegavault-mvp-0.6.53-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.53-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.53-dev.review-index.json`

## 0.6.53 delta

- Added a deterministic Cardano Preprod evidence-capture plan around the existing zero-budget Ogmios evaluation candidate.
- Freezes the action, transaction CBOR/body hash, request id and expected redeemer pointers before any live node interaction.
- Requires the UTxO snapshot, protocol parameters, Ogmios response and independent phase-1 validation to bind to one acquired Preprod tip.
- Normalizes Ogmios execution units with existing safety-margin and maxTxExUnits checks.
- Reuses the existing synchronized Cardano evaluation-evidence bundle and adds a top-level reproducibility/tamper digest.
- Fails closed on cross-tip, cross-transaction and non-independent phase-1 evidence.
- Explicitly keeps wallet signing, transaction submission, live-value movement, inclusion/finality claims and connector promotion unauthorized.

## Verification

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Cardano Preprod evidence harness: **6/6 passed**.
- Full suite: **443/443 passed**.
- Offline-resume: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global checks: **passed**.
- Deterministic source archive generation: **passed**.
- Checkpoint manifest generation: **passed**.
- External review index generation/verification: **passed**.

## Laptop-ready boundary

0.6.53 prepares the exact evidence-capture machinery so a later authorized laptop/network session can focus on synchronized Preprod captures rather than code or schema construction.

No public-network request is claimed by this checkpoint. No wallet signing or transaction submission path exists in the new harness.

## Next safe gate

During a later authorized laptop/network window, acquire synchronized Cardano Preprod state and evaluation evidence using the prepared capture plan. Do not sign or submit a transaction unless separately and explicitly authorized.

## Safety boundary

Never modify `main` directly or perform production deployments, mainnet/live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
