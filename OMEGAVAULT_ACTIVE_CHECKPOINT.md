# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.51-dev**

Archive filename: `omegavault-mvp-0.6.51-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.51-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.51-dev.review-index.json`

## 0.6.51 delta

- Added clean dependency-backed proof of the pinned Cardano/Aiken toolchain.
- Executed Aiken 1.1.24+bacbeb3 formatting, checks/tests and validator build.
- Verified the Cardano CIP-57 blueprint against source evidence.
- Verified applied policy/address and four canonical transaction-body fixtures with CSL 17.0.0.
- Verified signed-size, fee, minimum-ADA and collateral evidence.
- Verified zero-budget Ogmios evaluation requests.
- Preserved the fail-closed live-construction boundary.

## Verification

- Review/audit: **84/84 passed**.
- Stellar recovery: **20/20 passed**.
- Bitcoin recovery: **22/22 passed**.
- Maturity/provenance: **21/21 passed**.
- Cardano pinned toolchain/evidence lane: **passed**.
- Full suite: **433/433 passed**.
- Offline-resume: **ok: true**.
- Global checks: **passed**.
- Deterministic source archive generation: **passed**.
- Checkpoint manifest generation: **passed**.
- External review index generation/verification: **passed**.

## Promotion boundary

No connector is newly promoted by 0.6.51.

Cardano remains offline-verified. The pinned toolchain is now proven, but synchronized Preprod node evaluation, phase-1 validation at one acquired tip, submission/finality evidence and public-network proof remain unresolved.

## Next safe gate

Create a successor reconciliation checkpoint that removes only the stale Cardano toolchain-restoration blocker and registers the sealed 0.6.51 proof provenance, while preserving all real Preprod/live blockers.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
