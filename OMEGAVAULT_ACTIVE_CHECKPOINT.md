# OmegaVault Active Checkpoint

Current sealed development checkpoint: **0.6.53-dev**

Active checkpoint candidate: **0.6.54-dev**

Candidate branch: `dev/0.6.54-checkpoint-candidate`

## 0.6.54 candidate delta

- Adds a Cardano Preprod capture-session manifest bound to the exact sealed 0.6.53 evidence-harness checkpoint.
- Adds offline `cardano:preprod:prepare` command to generate the manifest, exact Ogmios request, capture directory and templates.
- Adds `cardano:preprod:verify` command to report missing capture files or deterministically bind a complete synchronized session.
- Requires at least two independently confirmed current Preprod protocol-parameter sources before accepting a complete session.
- Keeps wallet signing, transaction submission and live-value authority false.
- Performs no network requests itself.

## Candidate verification baseline

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Cardano Preprod evidence harness: **6/6 passed**.
- Cardano Preprod capture-session/manifest: **4/4 passed**.
- Full suite: **447/447 passed**.
- Offline-resume: **16/16 + 11/11 passed; ok: true**.
- Global checks: **passed**.

## Laptop-ready boundary

The later laptop session no longer needs manual manifest construction. It starts from the prepared commands and five capture files.

## Promotion boundary

No Cardano signing, submission, inclusion, finality or public-network recovery proof is claimed by 0.6.54.
