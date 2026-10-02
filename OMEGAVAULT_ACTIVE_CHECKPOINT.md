# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.30-dev**

Authoritative archive: `omegavault-mvp-0.6.30-dev.zip`
SHA-256: `96ca6578305dd44e11faff156bf692ebf775202a352b4e2f5d5f9a2e8267b032`
Dependency-lock binding SHA-256: `515fc619837afd2bebe0537a1b96109e77c110560faa9e9be720422477335d4b`

## 0.6.30 delta

- Added checkpoint-bound chain proof bundles.
- Every bundle requires the exact checkpoint ref, ZIP filename, archive SHA-256 and dependency-lock binding SHA-256.
- Every included chain proof is independently canonical-hashed; proof or checkpoint/archive drift invalidates verification.
- Duplicate chain/network/proof-kind entries fail closed.
- Optional parent-bundle SHA-256 lineage supports explicit proof-bundle chaining.
- Added a read-only post-install verification planner and `npm run verify:offline-resume`.
- The resume verifier refuses to execute when pinned dependencies are missing or mismatched and recommends `npm ci` only when lock integrity is valid.
- Once dependencies are exact, it runs the Stellar native-recovery and Bitcoin Noble-backed descriptor/PSBT/finalizer suites locally with no live-chain actions.

## Verification

- New proof-bundle + post-install/dependency/evidence slice: **22/22 passed**.
- Combined Cardano/evidence/EVM-XDC/finality/TRON/preflight/dependency/provenance regression slice: **60/60 passed**.
- `npm run check`: **passed**.
- Current stripped-workspace resume command exits safely with code 2 and recommends `npm ci`, exactly as designed.

## Promotion boundary

No chain maturity is promoted by this checkpoint. This is proof provenance and offline workstation-resume hardening only.

## Source of truth

The exact Library archive and checksums above are authoritative for 0.6.30.

## Next offline gate

Generate reproducible checkpoint metadata alongside proof bundles, then continue shared multichain capability/maturity metadata and backend/API contract hardening. When a workstation is available, run `npm ci` followed by `npm run verify:offline-resume` to reopen Stellar and Bitcoin cryptographic execution without live-chain actions.

## Safety boundary

Do not write directly to `main`. Do not perform production deployments, wallet signatures, production-value transfers, or claim live proof until corresponding promotion gates pass.
