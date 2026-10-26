"""Record actual OmegaVault launcher completions and scheduled-run count gaps.

Append-only issue #3: no source edits, signing, deployment or D1 mutation.
"""
import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ISSUE = 3
WORKFLOW = "omegavault-hourly-engineering.yml"
EXPECTED_PER_HOUR = 4
# Historical single-run audit began after its October 24 transition.
# Four-per-hour cron was committed at 2026-10-25T06:18:56Z.
# Exclude the partial transition hour: only full later hours expect four.
CUTOFF_UTC = "2026-10-24T06:00:00Z"
FOUR_PER_HOUR_START_UTC = "2026-10-25T07:00:00Z"
FOUR_PER_HOUR_TRANSITION_UTC = "2026-10-25T06:00:00Z"


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def audited_hour(now):
    end = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)
    return end - timedelta(hours=1), end


def expected_per_hour(start):
    """Only audit full hours under a known stable launcher cadence."""
    if start < parse_time(CUTOFF_UTC):
        return None
    if start < parse_time(FOUR_PER_HOUR_TRANSITION_UTC):
        return 1
    if start < parse_time(FOUR_PER_HOUR_START_UTC):
        return None
    return EXPECTED_PER_HOUR


def matching_scheduled(runs, start, end):
    """Unique GitHub schedule-triggered run IDs created within this UTC hour.

    A retry/duplicate API record is not another scheduling opportunity.
    created_at is *not* the intended cron slot; delayed runs may land in
    another hour and cannot be reliably assigned to their intended slot.
    """
    matches = {}
    for run in runs:
        if run.get("event") != "schedule" or not run.get("created_at"):
            continue
        run_id = run.get("id")
        if type(run_id) is not int or run_id <= 0:
            continue
        if start <= parse_time(run["created_at"]) < end:
            matches.setdefault(run_id, run)
    return list(matches.values())


def count_scheduled(runs, start, end):
    return len(matching_scheduled(runs, start, end))


def fetch_scheduled_window(repo, token, start, end):
    """Read all paginated run records; fail rather than undercount a partial response."""
    rows = []
    for page in range(1, 21):
        query = urlencode({"event": "schedule",
                           "created": iso(start) + ".." + iso(end - timedelta(seconds=1)),
                           "per_page": 100, "page": page})
        response = api("GET", repo, "actions/workflows/" + WORKFLOW + "/runs?" + query, token)
        chunk = response.get("workflow_runs")
        if not isinstance(chunk, list):
            raise RuntimeError("Schedule-run API response is missing workflow_runs.")
        rows.extend(chunk)
        if len(chunk) < 100:
            return rows
    raise RuntimeError("Schedule-run query exceeded pagination audit limit.")


def api(method, repo, path, token, body=None):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    req = Request("https://api.github.com/repos/" + repo + "/" + path,
                  method=method, data=payload,
                  headers={"Authorization": "Bearer " + token,
                           "Accept": "application/vnd.github+json",
                           "X-GitHub-Api-Version": "2022-11-28",
                           "User-Agent": "OmegaVault-Occurrence-Observer",
                           **({"Content-Type": "application/json"} if payload else {})})
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def existing_ids(repo, token, now):
    since = iso(now - timedelta(days=2))
    seen = set()
    for page in range(1, 21):
        query = urlencode({"since": since, "per_page": 100, "page": page})
        comments = api("GET", repo, "issues/%s/comments?%s" % (ISSUE, query), token)
        for item in comments:
            first = (item.get("body") or "").split("\n", 1)[0]
            if first.startswith("<!-- omv-observer:"):
                seen.add(first)
        if len(comments) < 100:
            return seen
    raise RuntimeError("Occurrence ledger too large to safely deduplicate.")


def post_once(repo, token, key, body, seen):
    marker = "<!-- omv-observer:" + key + " -->"
    if marker in seen:
        print("Already logged:", key)
        return
    api("POST", repo, "issues/%s/comments" % ISSUE, token,
        {"body": marker + "\n" + body})
    seen.add(marker)
    print("Logged:", key)


def observe_completion(repo, token, event, seen):
    run = event.get("workflow_run") or {}
    if run.get("name") != "OmegaVault Frequent AI Engineering Launcher":
        raise ValueError("Unexpected workflow name.")
    run_id = int(run["id"])
    attempt = int(run.get("run_attempt") or 1)
    fields = [
        "### Autonomous launcher completed",
        "- Run: " + str(run.get("html_url", "unknown")),
        "- Run ID: " + str(run_id),
        "- Attempt: " + str(attempt),
        "- Trigger event: " + str(run.get("event", "unknown")),
        "- Conclusion: " + str(run.get("conclusion", "unknown")),
        "- Actor: " + str((run.get("actor") or {}).get("login", "unknown")),
        "- Head SHA: " + str(run.get("head_sha", "unknown")),
        "- Created UTC: " + str(run.get("created_at", "unknown")),
        "- Started UTC: " + str(run.get("run_started_at", "unknown")),
        "- Updated UTC: " + str(run.get("updated_at", "unknown")),
        "",
        "GitHub does not authenticate which ChatGPT conversation, if any, originated this event."
    ]
    post_once(repo, token, "run:%s:%s" % (run_id, attempt), "\n".join(fields), seen)


def observe_schedule(repo, token, now, seen):
    start, end = audited_hour(now)  # Entire hour finished over 60 minutes ago.
    expected = expected_per_hour(start)
    if expected is None:
        print("Historical or cadence-transition hour: no shortfall inference.", iso(start))
        return

    runs = fetch_scheduled_window(repo, token, start, end)
    matching = matching_scheduled(runs, start, end)
    actual = len(matching)
    missing = max(0, expected - actual)
    run_ids = [run["id"] for run in matching]
    print(json.dumps({"audited_start_utc": iso(start), "audited_end_utc": iso(end),
                      "expected": expected, "observed": actual, "shortfall": missing,
                      "matching_run_ids": run_ids,
                      "attribution": "actual GitHub created_at hour, not intended cron slot"}))
    if missing:
        body = (
            "### Scheduled-run count shortfall\n"
            "- UTC window: " + iso(start) + " to " + iso(end) + "\n"
            "- Expected GitHub schedule-triggered runs: " + str(expected) + "\n"
            "- Observed distinct schedule-triggered runs created in window: " + str(actual) + "\n"
            "- Shortfall: " + str(missing) + "\n"
            "- Observed run IDs: " + str(run_ids) + "\n\n"
            "Observation only: a run created later may reflect a delayed trigger, "
            "and its intended cron slot is not authenticated by this query. "
            "This does not establish cancellation, intent, or which specific "
            "scheduled slots were missed. Existing historical evidence is preserved; "
            "this GitHub-native audit also depends on GitHub scheduling."
        )
        post_once(repo, token, "shortfall:" + iso(start), body, seen)


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["GH_TOKEN"]
    event = os.environ["GITHUB_EVENT_NAME"]
    now = datetime.now(timezone.utc)
    seen = existing_ids(repo, token, now)
    if event == "workflow_run":
        with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
            observe_completion(repo, token, json.load(f), seen)
    elif event in ("schedule", "workflow_dispatch"):
        observe_schedule(repo, token, now, seen)
    else:
        raise RuntimeError("Unknown observation event: " + event)


if __name__ == "__main__":
    main()
