"""Offline fixtures for OmegaVault occurrence observer (no network or token)."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/omegavault_occurrence_observer.py"
spec = importlib.util.spec_from_file_location("omv_observer", SCRIPT)
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ObserverTests(TestCase):
    def test_audit_waits_full_hour_plus_grace(self):
        start, end = observer.audited_hour(datetime(2026, 10, 24, 10, 13, tzinfo=timezone.utc))
        self.assertEqual(observer.iso(start), "2026-10-24T08:00:00Z")
        self.assertEqual(observer.iso(end), "2026-10-24T09:00:00Z")

    def test_only_schedule_runs_in_matching_hour_count(self):
        start, end = observer.audited_hour(datetime(2026, 10, 24, 10, 13, tzinfo=timezone.utc))
        runs = [
            {"id": 1, "event": "schedule", "created_at": "2026-10-24T08:07:00Z"},
            {"id": 2, "event": "schedule", "created_at": "2026-10-24T08:27:00Z"},
            {"id": 3, "event": "schedule", "created_at": "2026-10-24T08:47:00Z"},
            {"id": 4, "event": "push", "created_at": "2026-10-24T08:55:00Z"},
            {"id": 5, "event": "schedule", "created_at": "2026-10-24T09:07:00Z"}
        ]
        self.assertEqual(observer.count_scheduled(runs, start, end), 3)

    def test_historical_single_hour_has_no_shortfall_with_one_schedule_event(self):
        now = datetime(2026, 10, 24, 10, 13, tzinfo=timezone.utc)
        rows = [{"event": "schedule", "id": x, "created_at": "2026-10-24T08:%02d:00Z" % minute}
                for x, minute in enumerate((7,), start=1)]
        calls = []
        def mock_api(method, repo, path, token, body=None):
            calls.append((method, path))
            return {"workflow_runs": rows}
        with patch.object(observer, "api", mock_api):
            observer.observe_schedule("Minus99x/Omegavault", "fake", now, set())
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "GET")

    def test_shortfall_adds_one_deduplicated_comment(self):
        now = datetime(2026, 10, 24, 10, 13, tzinfo=timezone.utc)
        calls = []
        def mock_api(method, repo, path, token, body=None):
            calls.append((method, path, body))
            return {"workflow_runs": []} if method == "GET" else {"id": 1}
        seen = set()
        with patch.object(observer, "api", mock_api):
            observer.observe_schedule("Minus99x/Omegavault", "fake", now, seen)
            observer.observe_schedule("Minus99x/Omegavault", "fake", now, seen)
        posts = [c for c in calls if c[0] == "POST"]
        self.assertEqual(len(posts), 1)
        self.assertIn("shortfall:2026-10-24T08:00:00Z", posts[0][2]["body"])

    def test_cadence_transition_only_counts_full_known_hours(self):
        hours = {
            "2026-10-24T05:00:00Z": None,
            "2026-10-24T06:00:00Z": 1,
            "2026-10-25T05:00:00Z": 1,
            "2026-10-25T06:00:00Z": None,
            "2026-10-25T07:00:00Z": 4,
            "2026-10-26T04:00:00Z": 4,
        }
        for start, expected in hours.items():
            self.assertEqual(observer.expected_per_hour(observer.parse_time(start)), expected)

    def test_four_scheduled_opportunities_do_not_generate_shortfall(self):
        now = observer.parse_time("2026-10-25T11:13:00Z")  # audit 09:00-10:00
        rows = [{"event": "schedule", "id": idx,
                 "created_at": f"2026-10-25T09:{minute:02d}:00Z"}
                for idx, minute in enumerate((11, 26, 41, 56), 1)]
        rows += [{"event": "workflow_dispatch", "id": 100,
                  "created_at": "2026-10-25T09:20:00Z"}]
        calls = []
        def mock_api(method, repo, path, token, body=None):
            calls.append((method, path, body))
            return {"workflow_runs": rows}
        with patch.object(observer, "api", mock_api):
            observer.observe_schedule("Minus99x/Omv", "fake", now, set())
        self.assertEqual([item[0] for item in calls], ["GET"])
        self.assertIn("page=1", calls[0][1])

    def test_three_distinct_runs_report_exactly_one_missing(self):
        now = observer.parse_time("2026-10-25T11:13:00Z")
        rows = [{"event": "schedule", "id": idx,
                 "created_at": f"2026-10-25T09:{minute:02d}:00Z"}
                for idx, minute in enumerate((11, 26, 41), 1)]
        posts = []
        def mock_api(method, repo, path, token, body=None):
            if method == "POST":
                posts.append(body["body"])
                return {"id": 1}
            return {"workflow_runs": rows}
        with patch.object(observer, "api", mock_api):
            observer.observe_schedule("Minus99x/Omv", "fake", now, set())
        self.assertEqual(len(posts), 1)
        self.assertIn("- Expected GitHub schedule-triggered runs: 4", posts[0])
        self.assertIn("- Observed distinct schedule-triggered runs created in window: 3", posts[0])
        self.assertIn("- Shortfall: 1", posts[0])

    def test_duplicate_attempts_and_delayed_runs_are_not_false_successes(self):
        start = observer.parse_time("2026-10-25T09:00:00Z")
        end = observer.parse_time("2026-10-25T10:00:00Z")
        rows = [
            {"id": 10, "event": "schedule", "run_attempt": 1,
             "created_at": "2026-10-25T09:11:00Z"},
            {"id": 10, "event": "schedule", "run_attempt": 2,
             "created_at": "2026-10-25T09:11:00Z"},
            {"id": 11, "event": "schedule",
             "created_at": "2026-10-25T09:58:30Z"},
            {"id": 12, "event": "schedule",
             "created_at": "2026-10-25T10:05:00Z"},  # delayed into next hour
            {"id": 13, "event": "push",
             "created_at": "2026-10-25T09:40:00Z"},
            {"event": "schedule", "created_at": "2026-10-25T09:50:00Z"},
        ]
        matches = observer.matching_scheduled(rows, start, end)
        self.assertEqual([run["id"] for run in matches], [10, 11])
        self.assertEqual(observer.count_scheduled(rows, start, end), 2)

    def test_transition_hour_does_not_write_or_fetch(self):
        now = observer.parse_time("2026-10-25T08:13:00Z")  # audit 06:00-07:00
        with patch.object(observer, "api", side_effect=AssertionError("no API on transition")):
            observer.observe_schedule("Minus99x/Omv", "fake", now, set())

    def test_full_paginated_window_deduplicates_across_pages(self):
        start = observer.parse_time("2026-10-25T09:00:00Z")
        end = observer.parse_time("2026-10-25T10:00:00Z")
        page1 = [{"id": index + 1, "event": "schedule",
                  "created_at": "2026-10-25T09:11:00Z"} for index in range(100)]
        page2 = [page1[0], {"id": 101, "event": "schedule",
                           "created_at": "2026-10-25T09:26:00Z"}]
        def mock_api(method, repo, path, token, body=None):
            return {"workflow_runs": page2 if "page=2" in path else page1}
        with patch.object(observer, "api", mock_api):
            rows = observer.fetch_scheduled_window("Minus99x/Omv", "fake", start, end)
        self.assertEqual(len(rows), 102)
        self.assertEqual(observer.count_scheduled(rows, start, end), 101)

    def test_completion_records_run_once_and_does_not_invent_chat_origin(self):
        run = {"name": "OmegaVault Frequent AI Engineering Launcher",
               "id": 99, "run_attempt": 2, "event": "workflow_dispatch",
               "conclusion": "failure", "actor": {"login": "operator"},
               "created_at": "2026-10-24T08:00:00Z", "html_url": "https://github.com/run/99"}
        rows = []
        def mock_api(method, repo, path, token, body=None):
            rows.append((method, body))
            return {"id": 1}
        with patch.object(observer, "api", mock_api):
            seen = set()
            observer.observe_completion("Minus99x/Omegavault", "fake", {"workflow_run": run}, seen)
            observer.observe_completion("Minus99x/Omegavault", "fake", {"workflow_run": run}, seen)
        self.assertEqual(len(rows), 1)
        self.assertIn("run:99:2", rows[0][1]["body"])
        self.assertIn("does not authenticate", rows[0][1]["body"])


if __name__ == "__main__":
    main()
