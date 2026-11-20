"""serve_grants.sh against a local bare repository and a stub `gh` (needs bash, git, openssl).

Covers what the unit tests of issue_grant.py cannot: publishing, refusing when the
application's HEAD moves, retrying a transient API error, and above all the cancel path:
after a signal or a withdrawal no loop may be left that publishes a grant again.
"""
import base64
import json
import os
import pathlib
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
GATE_REPO = 'stefanf81/ghcr-approval-poc-gate'
APP_REPO = 'stefanf81/ghcr-approval-poc-app'
SHA = 'a' * 40

GH_STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
state = pathlib.Path(os.environ['FAKE_STATE'])
path = sys.argv[2]
failures = state / 'fail-next'
if failures.exists() and int(failures.read_text()) > 0:
    failures.write_text(str(int(failures.read_text()) - 1))
    print('{"message": "Bad Gateway"}')          # gh prints the error body on stdout
    sys.exit(1)
if path.endswith('/git/ref/heads/main'):
    print((state / 'head').read_text().strip())
elif '/check-runs' in path:
    print(json.dumps({'total_count': 1, 'check_runs': [
        {'id': 1, 'name': 'test', 'head_sha': os.environ['APP_COMMIT'], 'status': 'completed',
         'conclusion': 'success', 'started_at': '2026-11-20T10:00:00Z', 'app': {'slug': 'github-actions'}}]}))
else:
    sys.exit(9)
'''


@unittest.skipUnless(all(shutil.which(t) for t in ('bash', 'git', 'openssl')), 'needs bash, git and openssl')
class ServeGrantsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.remote = self.dir / 'remote.git'
        subprocess.run(['git', 'init', '-q', '--bare', str(self.remote)], check=True)
        self.state = self.dir / 'state'
        self.state.mkdir()
        (self.state / 'head').write_text(SHA)
        (self.dir / 'bin').mkdir()
        gh = self.dir / 'bin/gh'
        gh.write_text(GH_STUB)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (self.dir / 'runner').mkdir()
        key = self.dir / 'gate.key'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256',
                        '-out', str(key)], check=True, capture_output=True)
        self.env = dict(
            os.environ, PATH=f'{self.dir / "bin"}:{os.environ["PATH"]}', FAKE_STATE=str(self.state),
            APP_REPOSITORY=APP_REPO, APP_COMMIT=SHA, GH_TOKEN='dummy', GITHUB_REPOSITORY=GATE_REPO,
            RUNNER_TEMP=str(self.dir / 'runner'), GRANT_MINUTES='5',
            GATE_PRIVATE_KEY_B64=base64.b64encode(key.read_bytes()).decode(),
            # Hermetic git: no user/system config, and the GitHub URL points at the local remote.
            GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull, GIT_CONFIG_COUNT='1',
            GIT_CONFIG_KEY_0=f'url.file://{self.remote}.insteadOf',
            GIT_CONFIG_VALUE_0=f'https://github.com/{GATE_REPO}.git')
        self.procs = []

    def tearDown(self):
        for proc in self.procs:
            if proc.poll() is None:
                proc.terminate()                 # SIGTERM: the script's trap also stops its sleep
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            for stream in (proc.stdout, proc.stderr):
                if stream:
                    stream.close()
        self.tmp.cleanup()

    def script(self, mode, **extra):
        return subprocess.run(['bash', str(ROOT / 'serve_grants.sh'), mode], env=dict(self.env, **extra),
                              capture_output=True, text=True, timeout=120)

    def start_serve(self):
        proc = subprocess.Popen(['bash', str(ROOT / 'serve_grants.sh'), 'serve'], env=self.env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(proc)
        return proc

    def branch_files(self):
        result = subprocess.run(['git', f'--git-dir={self.remote}', 'ls-tree', '--name-only', 'grants'],
                                capture_output=True, text=True)
        return sorted(result.stdout.split()) if result.returncode == 0 else None

    def wait_for_grant(self, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if SHA in (self.branch_files() or []):
                return
            time.sleep(0.2)
        self.fail('no grant was published')

    def grant(self):
        text = subprocess.run(['git', f'--git-dir={self.remote}', 'show', f'grants:{SHA}'],
                              capture_output=True, text=True, check=True).stdout
        return json.loads(base64.b64decode(json.loads(text)['payload']))

    def test_serve_publishes_then_signal_stops_it_for_good(self):
        proc = self.start_serve()
        self.wait_for_grant()
        self.assertEqual(self.grant()['commit'], SHA)
        self.assertEqual(self.grant()['repository'], f'https://github.com/{APP_REPO}.git')
        proc.send_signal(signal.SIGTERM)                       # what a cancelled workflow step receives
        self.assertEqual(proc.wait(timeout=10), 130)           # at once, not after the 60 s sleep
        withdrawn = self.script('withdraw')
        self.assertEqual(withdrawn.returncode, 0, withdrawn.stderr)
        self.assertEqual(self.branch_files(), ['README.md'])
        time.sleep(1.5)
        self.assertEqual(self.branch_files(), ['README.md'])    # nothing publishes after the withdrawal

    def test_withdraw_stops_a_loop_that_got_no_signal(self):
        proc = self.start_serve()
        self.wait_for_grant()
        withdrawn = self.script('withdraw')
        self.assertEqual(withdrawn.returncode, 0, withdrawn.stderr)
        self.assertIsNotNone(proc.wait(timeout=10))
        self.assertEqual(self.branch_files(), ['README.md'])

    def test_moved_head_is_refused_and_withdrawn(self):
        proc = self.start_serve()
        self.wait_for_grant()
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=10)
        (self.state / 'head').write_text('b' * 40)
        result = self.script('serve')
        self.assertEqual(result.returncode, 1)
        self.assertIn('is not the main HEAD', result.stderr)
        self.assertEqual(self.branch_files(), ['README.md'])

    def test_transient_api_error_is_retried_without_polluting_the_answer(self):
        (self.state / 'fail-next').write_text('1')
        self.start_serve()
        self.wait_for_grant(timeout=40)
        self.assertEqual(self.grant()['checks'], {'tests': 'PASS'})

    def test_persistent_api_error_fails_closed(self):
        (self.state / 'fail-next').write_text('99')
        result = self.script('serve')
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(self.branch_files())                  # nothing was ever published

    def test_minutes_are_validated(self):
        for value in ('0', '91', 'ten', ''):
            with self.subTest(value=value):
                self.assertNotEqual(self.script('serve', GRANT_MINUTES=value).returncode, 0)
                self.assertIsNone(self.branch_files())


if __name__ == '__main__':
    unittest.main()
