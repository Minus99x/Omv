# OmegaVault AI automation branch

This branch contains **only the reusable GitHub Actions AI engineering worker and this README**. It is separate from production and development source code.

- Worker: `.github/workflows/omegavault-hourly-engineering.yml` (reusable `workflow_call`)
- Caller: `main` branch workflow of the same filename; GitHub dispatches the hourly cron on the default branch
- Recurrence: `27 * * * *` UTC (27 minutes past every hour, Arizona local time year-round)
- Extra one-off scheduling probe: October 23, 2026 04:56 UTC; remove probe expression after execution
- Checked-out code and exclusive commit target: `dev/0.6.60-reconcile-overnight-bitcoin`
- Approved code-change prefixes: `src/chains/`, `test/`, `docs/`, with independent full tests and checks required before a bot commit
- Authority boundary: no `main` code changes from the worker, live signing, broadcasting, deployment, keys, funds, or chain support-promotion
- Licensing: check provenance, license, compatibility, and security before reusing open-source libraries (including Safe components where applicable)
- Budget: existing GitHub plan/allowances; no paid Copilot subscription or external API key

## Execution receipt

The default-branch caller invokes this reusable workflow; the worker checks out the development branch and may commit there only after all validation succeeds. Each GitHub Actions run has its own event type (`push`, `schedule`, or `workflow_dispatch`), job results, log timestamps, and final bot commit. A push-triggered run does not prove that cron scheduling works; for that, inspect the event type `schedule`.

Do not change the repository default branch to this branch; `main` owns all time triggers.
