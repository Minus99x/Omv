# OmegaVault Active Checkpoint

Current sealed development checkpoint: **0.6.54-dev**

Active checkpoint candidate: **0.6.55-dev**

Candidate branch: `dev/0.6.55-checkpoint-candidate`

## 0.6.55 candidate delta

- Adds a strict workstation launch gate for the Cardano Preprod capture workflow.
- Verifies the sealed checkpoint sidecar against the exact source archive, extracted source tree and package/package-lock binding.
- Verifies the external review index before preparing a session.
- Requires installed pinned dependencies to match before proceeding.
- Keeps capture-session output outside the sealed source tree by default.
- Refuses silent overwrite of an existing capture-session manifest.
- Prepares the session only after all local gates pass and performs no network request.

## Candidate verification baseline

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
- Offline-resume: **16/16 + 11/11 passed; ok: true**.
- Global checks: **passed**.

## Laptop-ready boundary

After this checkpoint is sealed, the laptop sequence begins with one gate command against the extracted sealed bundle. Only after that returns `ok: true` should synchronized Preprod capture begin.

## Promotion boundary

No Cardano network request, wallet signature, transaction submission, inclusion/finality proof or public-network recovery proof is claimed by 0.6.55.
