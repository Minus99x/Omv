# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.57-dev**

Archive filename: `omegavault-mvp-0.6.57-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.57-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.57-dev.review-index.json`

## 0.6.57 delta

- Re-anchored Cardano Preprod capture to the exact sealed 0.6.56 Core Invariant Hardening checkpoint.
- Added a Cardano Preprod invariant-evidence program requiring all 13 canonical OmegaVault invariants.
- Required `initialize`, `heartbeat`, `approve`, and `execute` public-testnet lifecycle evidence before the invariant program can ever be considered complete.
- Explicitly kept synchronized evaluation insufficient for an “OmegaVault supported” claim.
- Carried invariant-program identity and fail-closed authority boundaries through session preparation, verification and workstation launch.
- Preserved all earlier sealed work and all no-sign/no-submit/no-promotion boundaries.

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
- Cardano Preprod invariant-evidence program: **6/6 passed**.
- Cardano workstation launch gate: **4/4 passed**.
- Full suite: **470/470 passed**.
- Offline-resume: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global checks: **passed**.

## Next Cardano objective

Seal 0.6.57, then use that exact sealed artifact on the user-controlled workstation. The launch gate itself remains offline. The next evidence acquisition requires Cardano Preprod network access to capture one synchronized tip, UTxOs, independently confirmed protocol parameters, Ogmios evaluation and independent phase-1 validation.

## Promotion boundary

Cardano remains `offline-verified`. 0.6.57 authorizes no wallet signature, transaction submission, live-value movement, production deployment, connector promotion, public-network recovery claim, or “OmegaVault supported” claim.
