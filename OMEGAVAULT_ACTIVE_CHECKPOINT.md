# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.58-dev**

Archive filename: `omegavault-mvp-0.6.58-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.58-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.58-dev.review-index.json`

## 0.6.58 delta

- Re-anchored Cardano Preprod capture to the exact sealed 0.6.57 checkpoint.
- Added one fail-closed campaign binding all four required lifecycle sessions: `initialize`, `heartbeat`, `approve`, and `execute`.
- Added exact per-action bindings for session manifest, invariant program, capture plan, transaction body and transaction CBOR identities.
- Added offline campaign preparation that creates all four workspaces, capture templates, Ogmios requests and an operator runbook in one operation.
- Added campaign verification that rejects missing/duplicate actions, action/session cross-wiring and authority escalation, and reports every missing external capture.
- Preserved all non-custodial, no-sign, no-submit, no-recovery-claim and no-support-promotion boundaries.

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
- Full suite: **476/476 passed**.
- Offline-resume: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global checks: **passed**.

## Next Cardano objective

Seal 0.6.58. The remaining Cardano step now genuinely requires a workstation plus Preprod network access: populate the externally acquired capture files for the prepared lifecycle campaign and verify them.

## Promotion boundary

Cardano remains `offline-verified`. 0.6.58 authorizes no wallet signature, transaction submission, live-value movement, production deployment, connector promotion, public-network recovery claim, or “OmegaVault supported” claim.
