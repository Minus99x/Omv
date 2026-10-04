# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.52-dev**

Archive filename: `omegavault-mvp-0.6.52-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.52-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.52-dev.review-index.json`

## 0.6.52 delta

- Registered the sealed 0.6.51 Cardano toolchain/evidence proof by exact archive SHA-256.
- Removed the obsolete Cardano/Aiken toolchain-restoration blocker.
- Kept Cardano at `offline-verified`.
- Added offline address-validation evidence from the sealed applied Preprod fixture.
- Preserved earlier 0.6.25/0.6.31 Cardano evidence references alongside the new 0.6.51 proof.
- Reframed the remaining Cardano blockers around synchronized Preprod Ogmios evaluation + independent phase-1 validation at one acquired tip, then submission/finality, wallet signing and public-network recovery evidence.
- Added a focused Cardano maturity/provenance reconciliation lane.

## Verification

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Full suite: **437/437 passed**.
- Offline-resume: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global checks: **passed**.
- Deterministic source archive generation: **passed**.
- Checkpoint manifest generation: **passed**.
- External review index generation/verification: **passed**.

## Promotion boundary

No connector is newly promoted by 0.6.52.

Cardano is offline-verified, not Preprod-public-network verified. Wallet signing, synchronized node evaluation, submission and finality remain gated.

## Next safe gate

Begin post-0.6.52 Cardano Preprod execution-evidence preparation so a later authorized laptop/network window can capture synchronized Ogmios/ledger evidence without inventing live proof in advance.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
