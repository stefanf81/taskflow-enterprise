"""serve_grants.sh against a local bare repository and a stub `gh` (needs bash, git, openssl).

Covers what the unit tests of issue_grant.py cannot: publishing, refusing when the
application's HEAD moves, retrying a transient API error, input validation, and above all the
cancel path: the real workflow step must stop on the runner's first signal, withdraw must stop
a loop that is still running, and a loop that somehow survives the withdrawal must not be able
to publish a grant again.
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
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
# One repository holds the pipeline, the app and the gate.
GATE_REPO = APP_REPO = 'stefanf81/base-image-gatekeeper'
SHA = 'a' * 40

GH_STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
state = pathlib.Path(os.environ['FAKE_STATE'])
path = sys.argv[2]
failures = state / 'fail-next'
if failures.exists() and int(failures.read_text()) > 0:
    failures.write_text(str(int(failures.read_text()) - 1))
    print('{"message": "Bad Gateway"}')          # gh prints the error body on stdout
    print('gh: Bad Gateway (HTTP 502)', file=sys.stderr)
    sys.exit(1)
if path.endswith('/git/ref/heads/main'):
    print((state / 'head').read_text().strip())
elif '/actions/runs?' in path:
    ci = ((state / 'ci').read_text().split() if (state / 'ci').exists() else ['completed', 'success']) + [None]
    assert 'head_sha=' + os.environ['APP_COMMIT'] in path and 'event=push' in path and 'branch=main' in path, path
    print(json.dumps({'total_count': 1, 'workflow_runs': [
        {'id': 7, 'path': '.github/workflows/example-app-ci.yml', 'head_sha': os.environ['APP_COMMIT'], 'event': 'push',
         'head_branch': 'main', 'status': ci[0], 'conclusion': ci[1],
         'created_at': '2026-11-20T10:00:00Z', 'repository': {'full_name': os.environ['APP_REPOSITORY']}}]}))
else:
    sys.exit(9)
'''


def workflow_step_script(name):
    """The `run: |` block of a step in release-gate.yml, as the runner writes it to a file."""
    lines = (REPO_ROOT / '.github/workflows/release-gate.yml').read_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == f'- name: {name}')
    run_at = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == 'run: |')
    indent = len(lines[run_at]) - len(lines[run_at].lstrip())
    body = []
    for line in lines[run_at + 1:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        body.append(line[indent + 2:] if line.strip() else '')
    return '\n'.join(body) + '\n'


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
            GITHUB_STEP_SUMMARY=str(self.dir / 'summary.md'),
            GATE_PRIVATE_KEY_B64=base64.b64encode(key.read_bytes()).decode(),
            # Hermetic git: no user/system config, and the GitHub URL points at the local remote.
            GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull, GIT_CONFIG_COUNT='1',
            GIT_CONFIG_KEY_0=f'url.file://{self.remote}.insteadOf',
            GIT_CONFIG_VALUE_0=f'https://github.com/{GATE_REPO}.git')
        self.env.pop('GRANT_INTERVAL_SECONDS', None)
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

    def start(self, argv, cwd=None, **extra):
        proc = subprocess.Popen(argv, cwd=cwd, env=dict(self.env, **extra),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(proc)
        return proc

    def start_serve(self, **extra):
        return self.start(['bash', str(ROOT / 'serve_grants.sh'), 'serve'], **extra)

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

    def test_serve_publishes_then_signal_stops_it_at_once(self):
        proc = self.start_serve()
        self.wait_for_grant()
        self.assertEqual(self.grant()['commit'], SHA)
        self.assertEqual(self.grant()['repository'], f'https://github.com/{APP_REPO}.git')
        self.assertEqual(self.grant()['checks'], {'tests': 'PASS'})
        proc.send_signal(signal.SIGTERM)
        self.assertEqual(proc.wait(timeout=5), 130)            # at once, not after the 60 s sleep
        self.assertFalse((self.dir / 'runner/serve-grants.pid').exists())
        withdrawn = self.script('withdraw')
        self.assertEqual(withdrawn.returncode, 0, withdrawn.stderr)
        self.assertEqual(self.branch_files(), ['README.md'])

    def test_workflow_step_stops_on_the_runners_first_signal(self):
        """The runner signals only the step's own process, SIGINT first. Run the step exactly as
        the runner does (a script file under `bash -e`): only its `exec` lets the signal reach
        the loop; without it the shell would wait for a loop that never heard the signal."""
        step = self.dir / 'step.sh'
        step.write_text(workflow_step_script('Re-issue the grant every minute'))
        self.assertIn('exec bash release-gate/serve_grants.sh serve', step.read_text())
        proc = self.start(['bash', '-e', str(step)], cwd=REPO_ROOT)
        self.wait_for_grant()
        proc.send_signal(signal.SIGINT)
        self.assertEqual(proc.wait(timeout=5), 130)
        self.assertIn('Cancel this run to revoke the grant.', (self.dir / 'summary.md').read_text())

    def test_withdraw_stops_a_loop_that_got_no_signal(self):
        proc = self.start_serve()
        self.wait_for_grant()
        reaper = threading.Thread(target=proc.wait)            # reap it, as the runner would
        reaper.start()
        started = time.monotonic()
        withdrawn = self.script('withdraw')
        elapsed = time.monotonic() - started
        reaper.join(timeout=10)
        self.assertEqual(withdrawn.returncode, 0, withdrawn.stderr)
        self.assertEqual(proc.returncode, 130)                 # stopped by withdraw's SIGTERM
        self.assertLess(elapsed, 8)                            # no 10 s wait for a process that is gone
        self.assertEqual(self.branch_files(), ['README.md'])

    def test_a_loop_that_survives_the_withdrawal_cannot_publish_again(self):
        """A push still in flight at cancel, or a loop withdraw could not stop: once withdraw has
        replaced the branch, the lease makes every later serve push fail and the loop exits."""
        first = self.script('withdraw')                        # the branch already exists: lease = its commit
        self.assertEqual(first.returncode, 0, first.stderr)
        proc = self.start_serve(GRANT_INTERVAL_SECONDS='1')
        self.wait_for_grant()
        other_temp = self.dir / 'other-runner'
        other_temp.mkdir()
        withdrawn = self.script('withdraw', RUNNER_TEMP=str(other_temp))   # cannot see the loop's pid file
        self.assertEqual(withdrawn.returncode, 0, withdrawn.stderr)
        self.assertEqual(proc.wait(timeout=40), 1)             # its next push was rejected
        self.assertIn('stale info', proc.stderr.read())
        self.assertEqual(self.branch_files(), ['README.md'])

    def test_unfinished_ci_waits_instead_of_refusing(self):
        """CI re-run (or still running when the gate starts): no grant yet, the loop keeps going,
        and the grant appears once the run has succeeded."""
        (self.state / 'ci').write_text('in_progress')
        proc = self.start_serve(GRANT_INTERVAL_SECONDS='1')
        time.sleep(4)
        self.assertIsNone(proc.poll(), 'the loop ended while CI was still running')
        self.assertIsNone(self.branch_files())                      # nothing granted yet
        (self.state / 'ci').write_text('completed success')
        self.wait_for_grant()
        self.assertIsNone(proc.poll())

    def test_failed_ci_is_refused_and_withdrawn(self):
        proc = self.start_serve(GRANT_INTERVAL_SECONDS='1')
        self.wait_for_grant()
        (self.state / 'ci').write_text('completed failure')
        self.assertEqual(proc.wait(timeout=20), 1)
        self.assertIn('Grant refused and withdrawn', proc.stderr.read())
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

    def test_minutes_and_interval_are_strict_decimals(self):
        for value in ('0', '91', 'ten', '', '060', '045', '08', '090', '1.5'):
            with self.subTest(minutes=value):
                result = self.script('serve', GRANT_MINUTES=value)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('value too great for base', result.stderr)
        for value in ('0', '61', '010', 'x'):
            with self.subTest(interval=value):
                self.assertNotEqual(self.script('serve', GRANT_INTERVAL_SECONDS=value).returncode, 0)
        self.assertIsNone(self.branch_files())


if __name__ == '__main__':
    unittest.main()
