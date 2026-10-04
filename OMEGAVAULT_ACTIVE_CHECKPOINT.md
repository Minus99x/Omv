# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.55-dev**

Archive filename: `omegavault-mvp-0.6.55-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.55-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.55-dev.review-index.json`

## 0.6.55 delta

- Added a strict workstation launch gate for Cardano Preprod evidence capture.
- Verifies the sealed checkpoint sidecar against the exact source archive, extracted source tree and dependency-lock binding.
- Verifies the external review index before a capture session is prepared.
- Requires installed pinned dependencies to match before proceeding.
- Defaults capture-session output outside the sealed source tree.
- Refuses silent overwrite of an existing session manifest.
- Only after all local gates pass does it prepare the Cardano session, without making a network request.

## Verification

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Cardano Preprod evidence harness: **6/6 passed**.
- Cardano Preprod capture-session/manifest: **4/4 passed**.
- Cardano workstation launch gate: **4/4 passed**.
- Full suite: **451/451 passed**.
- Offline-resume: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global checks: **passed**.
- Deterministic source archive generation: **passed**.
- Checkpoint manifest generation: **passed**.
- External review index generation/verification: **passed**.

## Laptop start

After extracting the sealed outer artifact and inner source ZIP:

`npm run cardano:preprod:launch -- --bundle-dir <outer-bundle-directory>`

If dependencies are missing, run `npm ci` and repeat the launch command.

Only after the launch command reports `ok: true` should synchronized Cardano Preprod capture begin.

## Promotion boundary

This checkpoint performs no Cardano network request and claims no wallet signature, transaction submission, inclusion/finality or public-network recovery proof.
