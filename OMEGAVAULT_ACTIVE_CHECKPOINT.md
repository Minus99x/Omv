# OmegaVault Active Checkpoint

Current sealed development checkpoint: **0.6.48-dev**

Archive filename: `omegavault-mvp-0.6.48-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.48-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.48-dev.review-index.json`

## 0.6.48 sealed scope

- Publisher-key trust history remains separate from detached signature authentication.
- Reviewer, publisher, anchoring-authority and publication-lineage trust remain explicit and independent.
- Audit append tooling preflights output destinations.
- Operator-audit API/HTTP/UI consistency is restored.
- Dependency-backed GitHub Actions verification is operational.

## Post-seal verified continuation

The current development branches contain verified work **after** the sealed 0.6.48 archive:

- Stellar native-recovery signed-envelope and execution-evidence binding.
- Recovery of the preserved 0.6.23 Bitcoin PSBTv2 finalizer from its checksum-verified archive.
- Runtime cryptographic proof of that finalizer with restored pinned dependencies.
- Deterministic, tamper-detectable Bitcoin finalizer execution evidence.
- Focused Stellar and Bitcoin GitHub Actions gates.

Current verification:

- Review/audit: **84/84**.
- Stellar recovery: **20/20**.
- Bitcoin recovery: **22/22**.
- Full suite: **432/432**.
- Offline resume: **ok: true**.
- Global checks: **passed**.

## Promotion boundary

No chain is newly promoted by this work.

Bitcoin remains reduced-semantics and has no Signet broadcast/public-network proof in this continuation. Stellar execution evidence does not grant signing, transaction submission, deployment, wallet authority or connector promotion.

## Current candidate

Candidate branch: **dev/0.6.49-checkpoint-candidate**

Candidate version: **0.6.49-dev**

The sealed 0.6.48 archive remains authoritative until the 0.6.49 candidate completes verification and produces fresh archive, checkpoint-manifest and review-index bindings.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
