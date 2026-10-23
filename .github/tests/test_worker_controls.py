"""Offline guard regressions. Run: python3 .github/tests/test_worker_controls.py.

Only Python's standard library and Git are required. The workflow's actual
validation shell is executed against disposable repositories; npm is a stub.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / 'workflows/omegavault-hourly-engineering.yml'
if not WORKFLOW.exists():
    WORKFLOW = Path(__file__).with_name('worker.yml')


def step_script(name):
    lines = WORKFLOW.read_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == '- name: ' + name)
    start = next(i for i in range(start, len(lines)) if lines[i].strip() == 'run: |') + 1
    end = start
    while end < len(lines) and (not lines[end] or lines[end].startswith('          ')):
        end += 1
    return '\n'.join(line[10:] for line in lines[start:end]) + '\n'


class GuardTests(unittest.TestCase):
    def check_patch(self, edits, allowed):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL)
            git('init', '-q')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'user.name', 'Offline test')
            for name in ['src/chains/base.js', 'test/base.test.js', 'docs/D1.md']:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('original\n')
            git('add', '.')
            git('commit', '-qm', 'fixture')
            for name, value in edits.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                if isinstance(value, tuple):
                    path.symlink_to(value[0])
                elif value is None:
                    path.unlink()
                else:
                    path.write_text(value)
            git('add', '-A')
            patch = git('diff', '--cached', '--binary')
            git('reset', '--hard', 'HEAD')
            (root / 'candidate.patch').write_bytes(patch)
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            stub = bin_dir / 'npm'
            stub.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> npm-calls\n')
            stub.chmod(0o755)
            result = subprocess.run(['bash', '-c', step_script('Validate paths, apply patch, run tests')],
                cwd=root, env={**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH']},
                text=True, capture_output=True)
            self.assertEqual(result.returncode == 0, allowed, result.stdout + result.stderr)
            calls = root / 'npm-calls'
            if allowed:
                self.assertEqual(calls.read_text().splitlines(), ['ci', 'test', 'run check'])
            else:
                self.assertFalse(calls.exists(), 'Candidate code executed before rejection')

    def test_valid_source(self):
        self.check_patch({'src/chains/base.js': 'corrected\n'}, True)

    def test_valid_test_with_newline_in_name(self):
        self.check_patch({'test/space and\nnewline.js': 'regression\n'}, True)

    def test_docs_only_rejected(self):
        self.check_patch({'docs/D1.md': 'overwritten\n'}, False)

    def test_docs_hidden_in_source_patch_rejected(self):
        self.check_patch({'docs/D1.md': None, 'src/chains/base.js': 'fix\n'}, False)

    def test_workflow_rejected(self):
        self.check_patch({'.github/workflows/evil.yml': 'changed\n'}, False)

    def test_symlink_rejected(self):
        self.check_patch({'test/policy': ('../docs/D1.md',)}, False)

    def test_rename_outside_allowed_paths_rejected(self):
        self.check_patch({'src/chains/base.js': None, 'package.json': 'original\n'}, False)

    def test_empty_patch_rejected(self):
        self.check_patch({}, False)

    def test_commit_records_run_origin(self):
        script = step_script('Commit verified engineering change without changing main')
        for field in ['Origin-Run:', 'Origin-Actor-ID:', 'Origin-Event:', 'Origin-Control-SHA:',
                      'Origin-Chat: not-applicable-github-actions']:
            self.assertIn(field, script)
        subprocess.run(['bash', '-n'], input=script, text=True, check=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
