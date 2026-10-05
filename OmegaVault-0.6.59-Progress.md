# OmegaVault 0.6.59 Progress

## One-command Cardano Preprod campaign launch completed

0.6.59 removes another workstation setup step while preserving the sealed-checkpoint and non-custodial boundaries.

- Re-anchored Cardano Preprod capture to the exact sealed 0.6.58 checkpoint:
  - source commit `f3f67a62d66dc9a509c85d33eb35674133e08bb3`
  - source archive SHA-256 `2e9129ed9d1eac5c61d85b625aebd7828988da8298c7b5914169769fde2bb463`
  - source-tree SHA-256 `59d543758df1915d36b4f7b984425a37503468704c187c6ceb4ed3cfd763ff58`
- Added a strict Cardano Preprod campaign workstation launcher.
- The launcher verifies the checkpoint manifest, exact source archive, extracted source tree, dependency lock and external review index before campaign creation.
- Only after those gates pass does it prepare the complete four-action campaign outside the sealed source tree.
- The launcher refuses preparation output that weakens network/signing/submission/support authority boundaries.
- A successful launch returns one campaign identity, one invariant-program identity, four lifecycle sessions, and the campaign verification command.
- No network request is performed by the launcher.

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
- Offline-resume verification: **16/16 Stellar + 11/11 Bitcoin; ok: true**.
- Global checks: **passed**.

## Laptop impact

The later workstation path is now one strict offline launch command that verifies the sealed checkpoint and prepares the entire Cardano lifecycle campaign. No separate per-action setup is required.

## Promotion boundary

Cardano remains `offline-verified`. 0.6.59 authorizes no wallet signature, transaction submission, live-value movement, production deployment, connector promotion, public-network recovery claim, or “OmegaVault supported” claim.
