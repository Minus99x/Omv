"""Offline-only regression tests for the independent worker's source guards."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SRC = Path(__file__).with_name("offhost_engineer.py")
SPEC = importlib.util.spec_from_file_location("offhost_engineer", SRC)
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class SafetyTests(unittest.TestCase):
    def git(self, root, *args):
        return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.DEVNULL)

    def fixture(self, root):
        self.git(root, "init", "-q")
        self.git(root, "config", "user.email", "test@example.invalid")
        self.git(root, "config", "user.name", "Test")
        for name in ("src/chains/base.js", "test/base.test.js", "docs/D1.md"):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("initial\n")
        self.git(root, "add", ".")
        self.git(root, "commit", "-qm", "baseline")

    def test_allowlist(self):
        for item in ("src/chains/st.js", "test/binding.test.js"):
            self.assertTrue(WORKER.allowed_path(item))
        for item in ("docs/D1.md", ".github/workflows/x.yml", "package.json",
                     "../src/chains/x", "src/chains/../docs/D1.md",
                     "src/chains/", "/test/foo", ""):
            self.assertFalse(WORKER.allowed_path(item), item)

    def test_disallowed_docs_and_symlink_rejected_before_any_tests(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            self.fixture(root)
            (root / "docs/D1.md").write_text("attack\n")
            with self.assertRaisesRegex(RuntimeError, "Disallowed"):
                WORKER.guard_worktree(root)
            self.git(root, "reset", "--hard")
            (root / "test/link").symlink_to("../docs/D1.md")
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                WORKER.guard_worktree(root)

    def test_good_candidate_and_index(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            self.fixture(root)
            (root / "src/chains/base.js").write_text("corrected\n")
            WORKER.guard_worktree(root)
            self.git(root, "add", "src/chains/base.js")
            WORKER.guard_index(root)

    def test_reject_index_outside_allowed_dirs(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            self.fixture(root)
            (root / "docs/D1.md").write_text("forged\n")
            self.git(root, "add", "docs/D1.md")
            with self.assertRaisesRegex(RuntimeError, "Disallowed"):
                WORKER.guard_index(root)


if __name__ == "__main__":
    unittest.main(verbosity=2)
