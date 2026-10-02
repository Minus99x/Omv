# OmegaVault 0.6.30-dev — Proof provenance & offline resume

Archive: `omegavault-mvp-0.6.30-dev.zip`

SHA-256:
`96ca6578305dd44e11faff156bf692ebf775202a352b4e2f5d5f9a2e8267b032`

Dependency-lock binding SHA-256:
`515fc619837afd2bebe0537a1b96109e77c110560faa9e9be720422477335d4b`

## Concrete changes

- Checkpoint/archive/dependency-lock-bound proof bundles.
- Per-proof canonical SHA-256 binding.
- Parent proof-bundle lineage.
- Offline-only workstation verification planner.
- One-command `npm run verify:offline-resume`.
- Fail-closed behavior when pinned dependencies are absent or mismatched.

## Verification

- New provenance/resume slice: 22/22 PASS.
- Combined regression slice: 60/60 PASS.
- Global project check: PASS.
- Stripped workspace safely exits with code 2 and recommends `npm ci`.

## Promotion boundary

No live-chain promotion is claimed.
