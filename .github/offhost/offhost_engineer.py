#!/usr/bin/env python3
"""OmegaVault off-host unattended engineering; no GitHub-hosted runner required.

Run on a dedicated Linux VM with NO wallet keys or production credentials.
Requires Python3, git, gh (authenticated), Node/npm and Copilot CLI (authenticated).
No GitHub Actions jobs are needed. This code NEVER submits transactions.
"""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

REPO = "Minus99x/Omegavault"
BRANCH = "dev/0.6.60-reconcile-overnight-bitcoin"
ISSUE = "3"
BASE_DIR = Path(os.environ.get("OMV_OFFHOST_HOME", str(Path.home() / ".local/share/omv-offhost")))
ALLOWED = ("src/chains/", "test/")
MAX_PATCH_ATTEMPTS = 2

PROMPT = (
    "You are OmegaVault's offline-only engineering worker in an isolated checkout of "
    "dev/0.6.60-reconcile-overnight-bitcoin. Read the current "
    "docs/OMEGAVAULT_0.6.60_AUTONOMOUS_OBJECTIVES.md and upstream-reuse catalog. "
    "Choose the highest-priority unmet OFFLINE objective; inspect actual source and "
    "tests before changing anything. Reuse proven license-compatible open source "
    "patterns; implement a meaningful security/correctness fix and adversarial and "
    "positive tests. Edit ONLY src/chains/ and test/. Do not create files elsewhere, "
    "change git state, commit, push, change policies, handle keys or credentials, "
    "sign, submit, broadcast, deploy, or contact public chain networks. Do not "
    "create cosmetic changes to inflate commit counts. The outer supervisor "
    "will validate and commit. Report actual tested results."
)


def stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def call(args, cwd=None, timeout=300, capture=False, output=None, check=True):
    with open(output, "a", encoding="utf-8") if output else open(os.devnull, "w") as log:
        proc = subprocess.run(
            args, cwd=cwd, timeout=timeout, check=False,
            stdout=subprocess.PIPE if capture else log,
            stderr=subprocess.PIPE if capture else subprocess.STDOUT,
            text=True, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        )
    if check and proc.returncode:
        raise RuntimeError("Command failed (exit %s): %s" % (proc.returncode, args[0]))
    return (proc.stdout or "").strip() if capture else proc.returncode


def git(path, *args, capture=True, **kwargs):
    return call(["git", *args], cwd=path, capture=capture, **kwargs)


def allowed_path(name):
    if not name or name.startswith("/") or ".." in name.split("/"):
        return False
    return name.startswith(ALLOWED) and not name.endswith("/")


def guard_worktree(path):
    # Porcelain -z names never contain literal NUL. Renames/copies fail closed.
    raw = subprocess.check_output(["git", "status", "--porcelain=v1", "-z",
                                   "--untracked-files=all"], cwd=path)
    for entry in filter(None, raw.split(b"\0")):
        if len(entry) < 4 or entry[:2].find(b"R") >= 0 or entry[:2].find(b"C") >= 0:
            raise RuntimeError("Unrecognized or renamed worktree path.")
        name = entry[3:].decode("utf-8", "surrogateescape")
        if not allowed_path(name) or (path / name).is_symlink():
            raise RuntimeError("Disallowed modified path or symlink: " + repr(name))


def guard_index(path):
    raw = subprocess.check_output(["git", "diff", "--cached", "--raw",
                                   "--no-renames", "-z"], cwd=path).split(b"\0")
    if not raw or raw == [b""]:
        raise RuntimeError("No staged source/test changes.")
    for pos in range(0, len(raw) - 1, 2):
        header, name = raw[pos:pos + 2]
        bits = header.split()
        if len(bits) < 5:
            raise RuntimeError("Malformed staged record.")
        mode = bits[1]
        filename = name.decode("utf-8", "surrogateescape")
        if not allowed_path(filename) or mode not in (b"000000", b"100644", b"100755"):
            raise RuntimeError("Disallowed staged path or mode: " + repr(filename))


def report(summary):
    BASE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    receipts = BASE_DIR / "occurrences.jsonl"
    with receipts.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(summary, sort_keys=True) + "\n")
    body = BASE_DIR / ("receipt-" + summary["id"] + ".md")
    body.write_text(
        "<!-- omv-offhost:" + summary["id"] + " -->\n"
        "### Independent engineering attempt\n\n"
        + "\n".join("- **%s:** %s" % (k, v) for k, v in summary.items())
        + "\n\nRuns on an isolated non-GitHub-hosted machine. "
          "This is not evidence of GitHub Actions runner availability.\n",
        encoding="utf-8"
    )
    try:
        call(["gh", "issue", "comment", ISSUE, "--repo", REPO, "--body-file", str(body)],
             timeout=40)
        body.unlink()
    except Exception:
        # Retain the receipt locally when GitHub API access fails.
        print("Receipt queued locally:", body, file=sys.stderr)


def preflight():
    missing = [x for x in ("git", "gh", "npm", "node", "copilot")
               if shutil.which(x) is None]
    if missing:
        raise RuntimeError("Missing tools: " + ", ".join(missing))
    call(["gh", "auth", "status", "-h", "github.com"], timeout=15)
    call(["copilot", "--version"], timeout=15)
    call(["gh", "repo", "view", REPO, "--json", "name"], timeout=20)
    print("Off-host prerequisites verified; no hosted GitHub Actions runner required.")


def run_once():
    BASE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ("pending", "rejected", "logs"):
        (BASE_DIR / name).mkdir(mode=0o700, exist_ok=True)
    lock = open(BASE_DIR / "worker.lock", "a+")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        report({"id": "busy-" + str(int(time.time())), "time": stamp(),
                "status": "skipped_concurrent", "commit": "none"})
        return 0
    attempt_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + str(os.getpid())
    summary = {"id": attempt_id, "time": stamp(), "status": "started",
               "source": "offhost-cron", "commit": "none"}
    with tempfile.TemporaryDirectory(prefix="omv-offhost-") as temp:
        folder = Path(temp) / "repo"
        log_path = BASE_DIR / "logs" / (attempt_id + ".log")
        try:
            preflight()
            call(["gh", "repo", "clone", REPO, str(folder), "--",
                  "--branch", BRANCH, "--single-branch"], timeout=240, output=log_path)
            base = git(folder, "rev-parse", "HEAD")
            summary["base"] = base
            # First retry an interrupted candidate; do not destroy work.
            pending = sorted((BASE_DIR / "pending").glob("*.patch"))
            candidate = pending[0] if pending else BASE_DIR / "pending" / (attempt_id + ".patch")
            generated = not pending
            if generated:
                call(["npm", "ci"], cwd=folder, timeout=360, output=log_path)
                call([
                    "copilot", "-p", PROMPT, "-s", "--no-ask-user",
                    "--allow-tool=read,write,shell(npm:*),shell(node:*),"
                    "shell(git diff:*),shell(git status:*),shell(git log:*)"
                ], cwd=folder, timeout=780, output=log_path)
                if git(folder, "rev-parse", "HEAD") != base:
                    raise RuntimeError("Worker changed Git HEAD: refusing candidate.")
                guard_worktree(folder)
                git(folder, "add", "-N", "--", "src/chains", "test", capture=False)
                raw = subprocess.check_output(
                    ["git", "diff", "--binary", "--", "src/chains", "test"], cwd=folder)
                if not raw.strip():
                    summary["status"] = "no_source_change"
                    return 0
                candidate.write_bytes(raw)
            summary["candidate"] = candidate.name
            trials_file = candidate.with_suffix(".tries")
            trials = int(trials_file.read_text()) if trials_file.exists() else 0
            trials_file.write_text(str(trials + 1))
            # Validate from the latest remote HEAD, not from the AI's checkout.
            git(folder, "reset", "--hard", base, capture=False)
            git(folder, "clean", "-fd", "--", "src/chains", "test", capture=False)
            git(folder, "fetch", "origin", BRANCH, capture=False, timeout=150)
            git(folder, "reset", "--hard", "origin/" + BRANCH, capture=False)
            if call(["git", "apply", "--check", "--index", str(candidate)],
                    cwd=folder, timeout=30, check=False):
                call(["git", "apply", "--3way", "--index", str(candidate)],
                     cwd=folder, timeout=50, output=log_path)
            else:
                call(["git", "apply", "--index", str(candidate)],
                     cwd=folder, timeout=30, output=log_path)
            guard_index(folder)
            git(folder, "diff", "--cached", "--check", capture=False)
            call(["npm", "ci"], cwd=folder, timeout=360, output=log_path)
            call(["npm", "test"], cwd=folder, timeout=720, output=log_path)
            call(["npm", "run", "check"], cwd=folder, timeout=240, output=log_path)
            git(folder, "config", "user.name", "omegavault-offhost-worker", capture=False)
            git(folder, "config", "user.email", "omegavault-offhost@users.noreply.github.com", capture=False)
            git(folder, "commit", "-m", "fix(eng): verified isolated off-host engineering candidate",
                "-m", "Origin-Event: offhost-cron\nOrigin-Attempt: " + attempt_id +
                "\nOrigin-Chat: not-applicable\nValidation: npm ci; npm test; npm run check",
                capture=False, output=log_path)
            head = git(folder, "rev-parse", "HEAD")
            call(["git", "push", "origin", "HEAD:refs/heads/" + BRANCH],
                 cwd=folder, timeout=120, output=log_path)
            summary["commit"] = head
            summary["status"] = "committed_verified"
            candidate.unlink(missing_ok=True)
            trials_file.unlink(missing_ok=True)
        except Exception as exc:
            summary["status"] = "failed"
            summary["error_type"] = type(exc).__name__
            summary["reason"] = str(exc)[:220]
            if "candidate" in summary:
                current = BASE_DIR / "pending" / summary["candidate"]
                tries = current.with_suffix(".tries")
                count = int(tries.read_text()) if tries.exists() else 0
                if count >= MAX_PATCH_ATTEMPTS and current.exists():
                    current.rename(BASE_DIR / "rejected" / current.name)
                    tries.unlink(missing_ok=True)
                    summary["status"] = "failed_candidate_retained_for_review"
            print(summary, file=sys.stderr)
        finally:
            report(summary)
    return 0 if summary["status"] in ("committed_verified", "no_source_change") else 1


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--preflight":
        try:
            preflight()
        except Exception as exc:
            sys.exit("Preflight failed: " + str(exc))
    elif len(sys.argv) == 2 and sys.argv[1] == "--once":
        sys.exit(run_once())
    else:
        sys.exit("Usage: python3 offhost_engineer.py --preflight | --once")
