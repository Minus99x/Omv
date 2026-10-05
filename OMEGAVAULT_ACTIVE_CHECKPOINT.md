# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.56-dev**

Archive filename: `omegavault-mvp-0.6.56-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.56-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.56-dev.review-index.json`

## 0.6.56 delta

- Formalized the canonical OmegaVault Core invariants without redesigning the recovery architecture.
- Added fail-closed recovery-readiness verification across owner status, quorum viability, trusted contacts, rescue configuration and compatibility/migration status.
- Added an explicit support-claim gate: promotion eligibility alone is insufficient; every core invariant must also have same-chain public-testnet evidence before a chain can be called “OmegaVault supported.”
- Added adversarial tests for authority separation, destination substitution, duplicate/single-credential quorum bypass, untrusted actors, premature execution, readiness tampering and evidence cross-wiring.
- Preserved the complete 0.6.51–0.6.55 Cardano lineage and all sealed proof boundaries.

## Verification

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Core invariant/support gate: **19/19 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Cardano Preprod evidence harness: **6/6 passed**.
- Cardano Preprod capture-session/manifest: **4/4 passed**.
- Cardano workstation launch gate: **4/4 passed**.
- Full suite: **466/466 passed**.
- Offline-resume: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global checks: **passed**.

## Cardano continuation

After this checkpoint is sealed, the next autonomous engineering objective is to re-anchor the Cardano Preprod capture path to the exact sealed 0.6.56 identity and bind the capture/result to the core-invariant evidence targets.

The subsequent synchronized Preprod capture remains a user-controlled workstation/network step.

## Promotion boundary

No blockchain is promoted by 0.6.56. Cardano remains `offline-verified`. This checkpoint authorizes no wallet signature, transaction submission, live-value movement, production deployment, connector promotion, or “OmegaVault supported” claim.
