"""Unit tests for issue_grant.py (needs python3 and openssl only)."""
import base64
import datetime as dt
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('issue_grant', ROOT / 'issue_grant.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

REPO = 'stefanf81/ghcr-approval-poc-app'
SHA = 'a' * 40


def run(conclusion='success', name='test', sha=SHA, slug='github-actions', status='completed', **extra):
    return dict({'id': 1, 'name': name, 'head_sha': sha, 'status': status, 'conclusion': conclusion,
                 'started_at': '2026-11-20T10:00:00Z', 'app': {'slug': slug}}, **extra)


def answer(*runs):
    return {'total_count': len(runs), 'check_runs': list(runs)}


class EvaluateTests(unittest.TestCase):
    def setUp(self):
        self.allowlist = gate.load_allowlist(ROOT / 'allowlist.json')

    def test_passes_for_main_head_with_successful_checks(self):
        self.assertEqual(gate.evaluate(REPO, SHA, SHA, answer(run()), self.allowlist), {'tests': 'PASS'})

    def test_refusals(self):
        cases = {
            'not the main HEAD': (REPO, SHA, 'b' * 40, answer(run())),
            'not in the gate allowlist': ('someone/else', SHA, SHA, answer(run())),
            'full lowercase': (REPO, SHA.upper(), SHA.upper(), answer(run())),
            "no GitHub Actions check-run 'test'": (REPO, SHA, SHA, answer(run(name='lint'))),
            'is completed/failure': (REPO, SHA, SHA, answer(run(conclusion='failure'))),
            'is in_progress/None': (REPO, SHA, SHA, answer(run(status='in_progress', conclusion=None))),
            'partial list': (REPO, SHA, SHA, {'total_count': 101, 'check_runs': [run()]}),
        }
        for message, args in cases.items():
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                gate.evaluate(*args, self.allowlist)

    def test_ignores_other_apps_and_other_commits(self):
        spoofed = answer(run(slug='some-other-app'), run(sha='c' * 40))
        with self.assertRaisesRegex(ValueError, 'no GitHub Actions check-run'):
            gate.evaluate(REPO, SHA, SHA, spoofed, self.allowlist)

    def test_latest_rerun_counts(self):
        old_fail = run(conclusion='failure', id=1, started_at='2026-11-20T10:00:00Z')
        new_pass = run(conclusion='success', id=2, started_at='2026-11-20T11:00:00Z')
        self.assertEqual(gate.evaluate(REPO, SHA, SHA, answer(old_fail, new_pass), self.allowlist),
                         {'tests': 'PASS'})
        with self.assertRaises(ValueError):
            gate.evaluate(REPO, SHA, SHA, answer(dict(new_pass, conclusion='failure'), dict(old_fail, conclusion='success')),
                          self.allowlist)

    def test_allowlist_shape_is_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'a.json'
            for bad in ({'issuer': 'i', 'record_schema': 's', 'repositories': {REPO: {'checks': {}}}},
                        {'issuer': 'i', 'record_schema': 's', 'repositories': {'no-slash': {'checks': {'t': ['t']}}}},
                        {'record_schema': 's', 'repositories': {}}):
                path.write_text(json.dumps(bad))
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    gate.load_allowlist(path)


class SignedGrantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.key, self.pub = self.dir / 'gate.key', self.dir / 'gate.pub'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256',
                        '-out', str(self.key)], check=True, capture_output=True)
        subprocess.run(['openssl', 'pkey', '-in', str(self.key), '-pubout', '-out', str(self.pub)],
                       check=True, capture_output=True)
        self.allowlist = gate.load_allowlist(ROOT / 'allowlist.json')

    def tearDown(self):
        self.tmp.cleanup()

    def test_record_fields(self):
        now = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.timezone.utc)
        record = json.loads(gate.record_bytes(REPO, SHA, {'tests': 'PASS'}, self.allowlist, now, 15))
        self.assertEqual(record, {
            'schema': 'https://example.org/verified-release/v1',
            'repository': f'https://github.com/{REPO}.git', 'commit': SHA,
            'issuer': 'stefanf81-poc-release-gate', 'decision': 'APPROVED', 'checks': {'tests': 'PASS'},
            'issuedAt': '2026-11-20T12:00:00Z', 'expiresAt': '2026-11-20T12:15:00Z'})
        for ttl in (0, 61):
            with self.subTest(ttl=ttl), self.assertRaises(ValueError):
                gate.record_bytes(REPO, SHA, {}, self.allowlist, now, ttl)

    def test_envelope_signature_verifies_over_exact_bytes(self):
        data = gate.record_bytes(REPO, SHA, {'tests': 'PASS'}, self.allowlist, dt.datetime.now(dt.timezone.utc), 15)
        doc = json.loads(gate.envelope(data, gate.sign(data, self.key)))
        self.assertEqual(set(doc), {'payloadType', 'payload', 'signature'})
        (self.dir / 'r.json').write_bytes(base64.b64decode(doc['payload']))
        (self.dir / 'r.sig').write_bytes(base64.b64decode(doc['signature']))
        verify = ['openssl', 'dgst', '-sha256', '-verify', str(self.pub), '-signature', str(self.dir / 'r.sig'),
                  str(self.dir / 'r.json')]
        self.assertIn('Verified OK', subprocess.run(verify, capture_output=True, text=True).stdout)
        (self.dir / 'r.json').write_bytes(base64.b64decode(doc['payload']).replace(b'APPROVED', b'APPROVEd'))
        self.assertNotEqual(subprocess.run(verify, capture_output=True).returncode, 0)

    def test_cli(self):
        runs = self.dir / 'runs.json'
        runs.write_text(json.dumps(answer(run())))
        out = self.dir / 'grant.json'
        cmd = ['python3', '-I', str(ROOT / 'issue_grant.py'), '--repository', REPO, '--commit', SHA,
               '--check-runs', str(runs), '--allowlist', str(ROOT / 'allowlist.json'), '--key', str(self.key),
               '--output', str(out)]
        ok = subprocess.run(cmd + ['--head-sha', SHA], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual(json.loads(base64.b64decode(json.loads(out.read_text())['payload']))['commit'], SHA)
        out.unlink()
        refused = subprocess.run(cmd + ['--head-sha', 'b' * 40], capture_output=True, text=True)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('GRANT REFUSED', refused.stderr)
        self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
