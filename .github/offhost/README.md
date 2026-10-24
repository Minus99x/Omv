# OmegaVault: independent unattended engineering fallback

**Why:** GitHub-hosted jobs in this private repository are currently ending before
a runner is allocated (runner_id 0, no steps). Retry and concurrency changes
cannot make a hosted runner appear. This fallback performs the engineering work
on an **isolated Linux computer or VM** with its own cron timer. GitHub is
used for Git source control and issue #3 receipts, **not for execution**.

## One-time requirements

- A **dedicated, powered-on Linux VM or spare computer**. No wallet keys,
  Lace/Yoroi profiles, private production credentials, or sensitive documents.
  Do not run the autonomous code agent directly on the workstation holding
  wallet secrets or the family's computer. Use a dedicated non-root Linux user.
- Python 3.10+, Git, GitHub CLI (gh), Node.js 22.12+, npm, cron, and the
  authenticated GitHub Copilot CLI (same AI worker family used in Actions).
- GitHub CLI authentication to private repo Minus99x/Omegavault with the
  minimum practical scoped source push and issue-comment permissions. Treat
  these credentials as capable of repository writes. Do not put tokens in
  files, crontab, shell history or GitHub source. A Copilot entitlement/
  authentication may be required and is not supplied by this repository.
- Access to a Linux shell on the machine **once**. No cloud provider is
  necessary if you already have always-on hardware.

## Installation (on isolated machine; NOT in ChatGPT)

Set up and authenticate gh and copilot using the providers' supported login
flows. Verify the official program binaries, Node version and installed
dependencies. Then run:

    gh auth status -h github.com
    gh auth setup-git
    git clone --branch automation/omegavault-hourly \
      https://github.com/Minus99x/Omegavault.git ~/omv-worker-control
    cd ~/omv-worker-control/.github/offhost
    python3 -m unittest -v test_offhost_engineer.py
    python3 offhost_engineer.py --preflight
    bash install_cron.sh

The installer **does not** register a GitHub-hosted runner and does not edit
existing GitHub schedules. It adds :07/:27/:47 executions to the local user's
crontab. The local script uses a single-instance lock and will report skipped
overlaps rather than silently run concurrent jobs.

For a controlled first real execution:

    python3 offhost_engineer.py --once

## Expected proof

1. Local chronological receipts:
   ~/.local/share/omv-offhost/occurrences.jsonl
2. Local detailed debug logs:
   ~/.local/share/omv-offhost/logs/
3. Issue #3 GitHub receipt on actual outcome:
   https://github.com/Minus99x/Omegavault/issues/3
4. For a validated commit, its SHA must appear on
   dev/0.6.60-reconcile-overnight-bitcoin with verified npm test/check.

On a failure, the candidate patch remains in pending/ for one bounded retry,
then rejected/ for review. The script does not claim a failed test as a pass.
If GitHub cannot be reached, the summary is retained locally in a
receipt-*.md file rather than discarded.

A completed or skipped local cron launch does **not** prove public-network
Cardano/XDC/Stellar/Bitcoin recovery. No signing, submission, broadcasting,
wallet keys or chain promotion is authorized.

## Reliability and scope boundaries

- The host must remain online, connected and authorized. If it is powered
  off, no local scheduling occurs. The independent cron survives individual
  chat changes and GitHub-hosted Actions quota outages, not hardware outages.
- It still depends on GitHub API availability for clone/push and on valid
  Copilot CLI authentication for generation. Failure there is logged; not
  silently bypassed.
- This path runs AI-generated code on the isolated host to test it. Treat the
  host as untrusted; it should contain only scoped credentials. Never use a
  workstation with wallet keys, browsers, or personal files.
- The existing GitHub-native schedule remains unchanged and may race with
  an off-host attempt. The branch-push step fails closed on stale branches;
  the patch stays for review/retry. The isolated host should be promoted to
  primary only after a verified real execution.
- An additional always-on cloud host could incur hosting costs. Reusing
  already-owned spare hardware avoids a new hosting subscription, but its
  electricity and Copilot usage are not necessarily free.
- The workflow is initially a testable **installed source package**, not an
  active runner. It only begins unattended execution after a machine is
  provisioned and install_cron.sh has actually been run there.

## Other engineering projects

The process can be replicated with separate repositories, isolated credentials
and task queues. Do not point OmegaVault's scoped access at unrelated repos or
enable the paused Seller Studio campaign without a new order.

All changes to this fallback live on automation/omegavault-hourly. Preserve
D1 and the main scheduler without silent overrides.
