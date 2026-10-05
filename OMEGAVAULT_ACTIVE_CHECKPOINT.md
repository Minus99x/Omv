# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.59-dev**

Archive filename: `omegavault-mvp-0.6.59-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.59-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.59-dev.review-index.json`

## 0.6.59 delta

- Re-anchored Cardano Preprod capture to the exact sealed 0.6.58 checkpoint.
- Added a strict one-command workstation launcher for the complete four-action Cardano Preprod campaign.
- Verifies exact archive/source-tree/dependency/review identity before campaign creation.
- Prepares all `initialize`, `heartbeat`, `approve`, and `execute` sessions outside the sealed source tree only after workstation gates pass.
- Carries exact campaign and invariant-program identities through the handoff.
- Fails closed if preparation weakens network/signing/submission/support authority.
- Performs no network request.

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
- Cardano Preprod four-action campaign: **6/6 passed**.
- Cardano workstation launch gate: **4/4 passed**.
- Cardano campaign workstation launch gate: **2/2 passed**.
- Full suite: **478/478 passed**.
- Offline-resume: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global checks: **passed**.

## Next Cardano objective

Seal 0.6.59. The remaining material step requires a workstation plus Cardano Preprod network access to populate the externally acquired campaign captures and verify them.

## Promotion boundary

Cardano remains `offline-verified`. 0.6.59 authorizes no wallet signature, transaction submission, live-value movement, production deployment, connector promotion, public-network recovery claim, or “OmegaVault supported” claim.
