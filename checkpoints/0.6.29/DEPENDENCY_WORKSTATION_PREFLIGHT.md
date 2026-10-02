# OmegaVault 0.6.29-dev — Dependency & workstation preflight

Archive: `omegavault-mvp-0.6.29-dev.zip`

SHA-256:
`80ad4ceecb8645601928c132c0ad0e4b52a9faa38d552fca41b87f656b39cd9a`

## Concrete changes

- Exact semver pin verification.
- Root package-lock/package.json agreement checks.
- Exact resolved-version verification.
- SHA-512 integrity enforcement for top-level locked packages.
- SHA-256 package/lock binding.
- Read-only workstation package/tool inventory.
- Deterministic `npm ci` recommendation.

## Verification

- Dependency/workstation tests: 5/5 PASS.
- Combined regression slice: 51/51 PASS.
- Global check: PASS.

## Promotion boundary

No live-chain promotion is claimed by this checkpoint.
