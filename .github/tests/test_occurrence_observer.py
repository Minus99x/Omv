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

    def test_no_shortfall_comment_when_one_scheduled_event_exists(self):
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
