# OmegaVault scheduler-only branch

This branch is deliberately restricted to **GitHub Actions scheduler infrastructure**; it carries no application code, wallet, keys, deployment files, or production assets.

- Scheduler: `.github/workflows/omegavault-hourly-engineering.yml`
- Cron: `27 * * * *` (hourly UTC, subject to GitHub's scheduler jitter)
- Source/commit target: `dev/0.6.60-reconcile-overnight-bitcoin` **only**
- GitHub Actions bot can propose changes only to `src/chains/`, `test/`, `docs/` in the existing private OmegaVault repository, after `npm test` and `npm run check`.
- `main` is not a target; do not merge this branch into `main`.
- Existing vetted third-party open-source components (e.g. Safe primitives if relevant) may be used subject to license, provenance, compatibility, and security review.
- No keys, secrets, signing, broadcasting, deployment, funds or support promotion.
- Free-plan bounded execution; no subscription or extra service required.

## Trigger boundary

GitHub **only dispatches scheduled workflows from the repository's configured default branch**. This branch is not currently the repository default. Its `push` trigger permits a direct proof of the worker execution without changing `main`. To activate true hourly scheduling, GitHub must designate this branch as default **or** a dedicated scheduler repository must host its own workflow as default. Changing default branches also affects other GitHub repository behavior and is a separate account-level operation.

This scheduler does not host or mirror OmegaVault product source. The engineering checkout targets `dev/0.6.60-reconcile-overnight-bitcoin` on every run.
