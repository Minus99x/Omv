# OmegaVault Active Checkpoint

Current development checkpoint: **0.6.48-dev**

Archive filename: `omegavault-mvp-0.6.48-dev.zip`
Checkpoint sidecar filename: `omegavault-mvp-0.6.48-dev.checkpoint-manifest.json`
External review index filename: `omegavault-mvp-0.6.48-dev.review-index.json`

## 0.6.48 delta

- Added separately configured publisher-key trust history with enroll, rotate and revoke events.
- Kept cryptographic publisher authentication separate from publisher identity approval/trust.
- A valid signature from an old, rotated, revoked or identity-mismatched key remains cryptographically authenticated but is not trusted.
- Added publisher-trust snapshots, rollback/tamper detection, canonical-field enforcement and strict authority boundaries.
- Added `--require-trusted-publisher` fail-closed verification.
- Hardened reviewer-trust, reviewer trust-policy anchor-history, publication-history and publisher-trust append CLIs so output destinations are preflighted before writes; invalid or colliding destinations cannot leave partial history files.
- Restored and regression-tested the operator-audit API contract, HTTP endpoint and UI path.
- Added `npm run test:review-audit` and a GitHub Actions development verification workflow using pinned dependencies.

## Verification

Clean dependency-backed GitHub Actions verification completed on the development branch:

- Pinned dependency install with `npm ci`: **passed**.
- Focused review/audit security suite: **84/84 passed**.
- Full test suite: **415/415 passed**.
- Offline-resume verification: **ok: true**.
- Global `npm run check`: **passed**.

The previously known operator-audit mismatches are no longer carried as exceptions.

## Promotion boundary

No chain is newly promoted by this checkpoint.

Publisher trust is explicit policy metadata only. It grants no reviewer trust, anchoring-authority trust, chain maturity, chain promotion, evidence promotion, deployment authority, wallet authority or live proof. Publication-current lineage remains an independent requirement.

## Next safe gate

Use the now-available dependency-backed remote verification lane to continue native execution evidence work. Start with Stellar native-recovery execution evidence, then continue Bitcoin finalizer execution evidence, preserving all existing maturity and live-value boundaries.

## Workstation status

A local workstation is no longer required merely to restore dependencies and execute the pinned offline verification suite; clean dependency-backed verification is now demonstrated in GitHub Actions. A workstation/user remains necessary only for genuinely local, interactive, wallet-controlled or user-authorized steps.

## Safety boundary

Never modify `main` directly or perform production deployments, live-value transactions, wallet signatures, secret handling or irreversible external actions from this development queue.
