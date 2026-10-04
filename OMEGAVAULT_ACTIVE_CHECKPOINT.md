# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.54-dev**

Archive filename: `omegavault-mvp-0.6.54-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.54-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.54-dev.review-index.json`

## 0.6.54 delta

- Added a Cardano Preprod capture-session manifest bound to the sealed 0.6.53 evidence-harness checkpoint.
- Added offline `npm run cardano:preprod:prepare` command to generate the capture manifest, exact Ogmios request, session directories and JSON templates.
- Added `npm run cardano:preprod:verify` command to report missing capture files or deterministically bind a complete synchronized session.
- Requires at least two independently confirmed current Preprod protocol-parameter sources before accepting a complete session.
- Manifest validation fails closed on checkpoint drift, digest tampering or authority escalation.
- Performs no network requests itself and exposes no signing or transaction-submission path.

## Verification

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano toolchain/evidence: **passed**.
- Cardano reconciliation: **12/12 passed**.
- Cardano Preprod evidence harness: **6/6 passed**.
- Cardano Preprod capture-session/manifest: **4/4 passed**.
- Full suite: **447/447 passed**.
- Offline-resume: **ok: true** with **16/16** Stellar and **11/11** Bitcoin checks.
- Global checks: **passed**.
- Deterministic source archive generation: **passed**.
- Checkpoint manifest generation: **passed**.
- External review index generation/verification: **passed**.

## Laptop-ready boundary

Laptop mode now starts from a generated session manifest rather than manual evidence-file assembly.

No Cardano signing, transaction submission, inclusion, finality or public-network recovery proof is claimed by this checkpoint.

## Next safe gate

Add a workstation launch gate that verifies the sealed tooling checkout/dependencies before preparing the Preprod capture session, so the later laptop run can begin with one command.
