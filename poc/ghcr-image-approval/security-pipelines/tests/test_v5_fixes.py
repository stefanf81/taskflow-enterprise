"""Regression tests for the v4 -> v5 review findings (one class per finding, numbered as in CHANGES.md).

Unit and static tests only. The same fixes were also exercised with the real pinned tools
(see CHANGES.md); that run cannot be repeated offline, so these tests pin the behaviour.
"""
import base64
import copy
import datetime
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
import urllib.error

try:
    import yaml
except ImportError:
    yaml = None

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / '.github/workflows'
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests'))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tools = load('v5_tools', 'ci/install_verified_tools.py')
audit = load('v5_audit', 'ci/audit_repo_settings.py')
additive = load('v5_additive', 'ci/check_additive_layers.py')
evaluate = load('v5_evaluate', 'scripts/evaluate.py')
fp = load('v5_fingerprint', 'scripts/policy_fingerprint.py')
from test_v3_fixes import Finding13RepositorySettingsAuditTests, archive, layer  # noqa: E402

LOCK = json.loads((ROOT / 'ci/toolchain.lock.json').read_text())
PTYPE = 'https://example.org/ghcr-base-approval/v1'


def make_executable(path, text):
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def shell_functions(text):
    """{name: body} of the top-level `name() { ... }` functions of a bash script."""
    return {m.group(1): m.group(2) for m in re.finditer(r'(?m)^(\w+)\(\) \{\n(.*?)^\}', text, re.S)}


def tools_used(body, functions, seen=None):
    """Pinned tools a function body runs, following calls to other functions of the script."""
    seen = seen or set()
    code = '\n'.join(line for line in body.splitlines() if not line.lstrip().startswith('#'))
    used = {t for t in tools.PINNED if re.search(rf'(?<![\w./-]){t}\s', code)}
    if 'verify_bases.sh' in code:
        used.add('cosign')
    for name, other in functions.items():
        if name not in seen and re.search(rf'(?m)(?:^|;|&&|\|\||\bdo|\bthen)\s*{name}\b', code):
            used |= tools_used(other, functions, seen | {name})
    return used


class Finding1InstallerTests(unittest.TestCase):
    """v4: 120 MiB binary limit < 139 MiB cosign binary; diffoci listed as tar.gz; three empty pins."""

    def test_shipped_lock_is_complete_for_every_job_kind(self):
        for kind, needs in tools.NEEDS.items():
            with self.subTest(kind=kind):
                self.assertTrue(tools.validate_lock(LOCK, needs))
        self.assertEqual(set(LOCK['tools']), set(tools.PINNED))
        self.assertNotIn('REPLACE', json.dumps(LOCK))

    def test_every_pinned_asset_fits_the_limits(self):
        for name, item in LOCK['tools'].items():
            self.assertLessEqual(item['size'], tools.MAX_DOWNLOAD_BYTES, name)
            if item['format'] == 'raw':
                self.assertLessEqual(item['size'], tools.MAX_BINARY_BYTES, name)
        self.assertGreater(LOCK['tools']['cosign']['size'], 120 * 1024 * 1024)  # the v4 limit

    def test_asset_larger_than_the_limit_is_rejected_before_download(self):
        lock = copy.deepcopy(LOCK)
        lock['tools']['cosign']['size'] = tools.MAX_DOWNLOAD_BYTES + 1
        with self.assertRaisesRegex(ValueError, 'exceeds the download limit'):
            tools.validate_lock(lock, {'cosign'})

    def test_release_file_formats(self):
        # diffoci and cosign publish bare binaries; the others publish tar.gz archives.
        self.assertEqual(LOCK['tools']['diffoci']['format'], 'raw')
        self.assertEqual(LOCK['tools']['cosign']['format'], 'raw')
        for name in ('crane', 'syft', 'grype', 'gh', 'actionlint'):
            self.assertEqual(LOCK['tools'][name]['format'], 'tar.gz')

    def one(self, blob, **changes):
        item = {'version': 'v1.2.3', 'url': 'https://github.com/o/r/releases/download/v1.2.3/asset',
                'sha256': hashlib.sha256(blob).hexdigest(), 'size': len(blob), 'format': 'raw', 'member': 'crane'}
        item.update(changes)
        return {'schema': 2, 'platform': 'linux/amd64', 'tools': {'crane': item}}

    def test_size_mismatch_and_incomplete_entries_rejected(self):
        blob = b'binary'
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError, 'lock says'):
                tools.install(self.one(blob, size=7), {'crane'}, d, lambda url: blob)
        for changes, message in (({'size': None}, 'asset size'), ({'version': 'latest'}, 'exact release version'),
                                 ({'format': 'rar'}, 'format must be'), ({'member': '../x'}, 'archive member'),
                                 ({'url': 'https://example.org/releases/download/v1.2.3/asset'}, 'GitHub release')):
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(ValueError, message):
                    tools.validate_lock(self.one(blob, **changes), {'crane'})

    def test_member_inside_a_directory_of_the_archive(self):
        binary = b'#!/bin/sh\necho gh\n'
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as tf:
            for name, data in (('gh_1.2.3_linux_amd64/LICENSE', b'x'), ('gh_1.2.3_linux_amd64/bin/gh', binary)):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))
        blob = buf.getvalue()
        lock = self.one(blob, format='tar.gz', member='gh_1.2.3_linux_amd64/bin/gh')
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual((tools.install(lock, {'crane'}, d, lambda url: blob) / 'crane').read_bytes(), binary)

    def test_download_retries_transient_errors_only(self):
        calls = []

        class Response:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self, n): return b'ok'

        def flaky(req, timeout, context):
            calls.append(1)
            if len(calls) < 3:
                raise urllib.error.URLError('reset')
            return Response()
        original = tools.urllib.request.urlopen
        tools.urllib.request.urlopen = flaky
        try:
            url = 'https://github.com/o/r/releases/download/v1.2.3/asset'
            self.assertEqual(tools._download(url, sleep=lambda s: None), b'ok')
            self.assertEqual(len(calls), 3)
            del calls[:]
            tools.urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(urllib.error.URLError('down'))
            with self.assertRaises(urllib.error.URLError):
                tools._download(url, sleep=lambda s: None)
        finally:
            tools.urllib.request.urlopen = original

    def test_every_job_installs_the_tools_its_script_runs(self):
        """v4 also installed crane+grype for `rescan` and crane for `push` while require_tools.sh
        demanded cosign and gh for both, so those jobs could not pass either."""
        functions = shell_functions((ROOT / 'ci/application_pipeline.sh').read_text())
        functions.update(shell_functions((ROOT / 'ci/common.sh').read_text()))
        kinds = {'image_build': 'image-build', 'scan': 'scan', 'push_candidate': 'push', 'promote_image': 'promote',
                 'rescan': 'rescan', 'issue_verifier': 'verify', 'final_sign': 'promote'}
        for function, kind in kinds.items():
            with self.subTest(function=function):
                self.assertLessEqual(tools_used(functions[function], functions), tools.NEEDS[kind])
        common = shell_functions((ROOT / 'ci/common.sh').read_text())
        for script, kind in (('base_precheck.sh', 'promote'), ('base_quarantine.sh', 'promote'),
                             ('base_evaluate.sh', 'base'), ('base_promote.sh', 'promote')):
            with self.subTest(script=script):
                body = (ROOT / 'ci' / script).read_text()
                if 'compare.sh' in body:
                    body += (ROOT / 'scripts/compare.sh').read_text()
                self.assertLessEqual(tools_used(body, common), tools.NEEDS[kind])

    @unittest.skipIf(yaml is None, 'PyYAML required')
    def test_workflow_jobs_install_before_checking_and_with_the_same_kind(self):
        for name in ('application-release.yml', 'base-image-approval.yml'):
            for job_name, job in yaml.safe_load((WF / name).read_text())['jobs'].items():
                text = json.dumps(job['steps'])
                installed = re.findall(r'install_verified_tools\.py --kind ([a-z-]+)', text)
                required = re.findall(r'require_tools\.sh ([a-z-]+)', text)
                with self.subTest(job=job_name):
                    self.assertLessEqual(len(installed), 1)
                    for kind in required:
                        self.assertEqual(installed, [kind])
                    if re.search(r'(?<![\w./-])gh (api|attestation)', text) or 'require_gh_attestation' in text:
                        self.assertTrue(installed and 'gh' in tools.NEEDS[installed[0]], 'gh must be the pinned copy')
                    for call in re.findall(r'application_pipeline\.sh ([a-z]+)', text):
                        if call != 'build':   # the untrusted compile job has no registry tools
                            self.assertTrue(installed, f'{call} needs the installer')
                    self.assertNotIn('python3 ci/install_verified_tools.py', text)  # always with -I


class Finding2CosignV3FlagsTests(unittest.TestCase):
    """cosign v3 rejects --tlog-upload=false unless --use-signing-config=false is given too."""

    def test_flags_defined_once_with_both_switches(self):
        text = (ROOT / 'ci/common.sh').read_text()
        self.assertIn('COSIGN_SIGN_FLAGS=(--yes --use-signing-config=false --tlog-upload=false)', text)
        self.assertGreaterEqual(int(LOCK['tools']['cosign']['version'].lstrip('v').split('.')[0]), 3)

    def test_every_sign_and_attest_uses_them(self):
        found = 0
        for path in list((ROOT / 'ci').glob('*.sh')) + list((ROOT / 'scripts').glob('*.sh')):
            for line in path.read_text().splitlines():
                if re.search(r'^\s*cosign (sign|attest)\b', line):
                    found += 1
                    self.assertIn('"${COSIGN_SIGN_FLAGS[@]}"', line, f'{path.name}: {line.strip()}')
                    self.assertNotIn('--tlog-upload', line)
        self.assertEqual(found, 7)   # base: sign + attest; bootstrap: sign + attest; application: sign + SBOM + build record
        for script in ('base_promote.sh', 'application_pipeline.sh'):
            self.assertIn('source "$(dirname "${BASH_SOURCE[0]}")/common.sh"', (ROOT / 'ci' / script).read_text())

    @unittest.skipUnless(shutil.which('cosign'), 'cosign not installed')
    def test_installed_cosign_knows_the_flag(self):
        version = subprocess.run(['cosign', 'version'], capture_output=True, text=True).stdout
        match = re.search(r'GitVersion:\s+v(\d+)', version)
        if not match or int(match.group(1)) < 3:
            self.skipTest('needs cosign v3')
        ref = '127.0.0.1:1/none@sha256:' + 'a' * 64
        refusal = 'not supported with --signing-config or --use-signing-config'
        v4_flags = subprocess.run(['cosign', 'sign', '--yes', '--tlog-upload=false', '--key', 'missing.key', ref],
                                  capture_output=True, text=True)
        self.assertIn(refusal, v4_flags.stderr)                      # what v4 ran into
        v5_flags = subprocess.run(['cosign', 'sign', '--yes', '--use-signing-config=false', '--tlog-upload=false',
                                   '--key', 'missing.key', ref], capture_output=True, text=True)
        self.assertNotIn(refusal, v5_flags.stderr)                   # fails later, on the missing key
        self.assertNotEqual(v5_flags.returncode, 0)


class Finding3SyftFileListTests(unittest.TestCase):
    """Syft reports the JDK as java-jvm-installation with `files` as plain strings; v4 crashed."""

    SBOM = {'artifacts': [
        {'name': 'openjdk', 'type': 'binary', 'version': '21.0.13+9-LTS', 'metadataType': 'java-jvm-installation',
         'metadata': {'files': ['/opt/java/openjdk/NOTICE', '/opt/java/openjdk/bin/java']}},
        {'name': 'openssl', 'type': 'deb', 'version': '3.0', 'metadataType': 'dpkg-db-entry',
         'metadata': {'files': [{'path': '/usr/bin/openssl'}, {'path': None}, 'stray-string', 7]}},
        {'name': 'odd', 'type': 'x', 'metadata': {'files': {'not': 'a list'}}},
        {'name': 'none', 'type': 'go-module', 'metadata': {}},
    ]}

    def test_string_entries_do_not_crash_and_do_not_claim_ownership(self):
        owners = evaluate.file_owners(self.SBOM)
        self.assertEqual(owners, {'usr/bin/openssl': {('openssl', 'deb')}})
        # The JDK tree stays under vendor_managed_prefixes, not package ownership.
        self.assertFalse(evaluate.owners_of('opt/java/openjdk/bin/java', owners))


class Finding4FingerprintTests(unittest.TestCase):
    """v4 demanded the CURRENT fingerprint from the OLD baseline: one change anywhere in
    policy/, scripts/, ci/ or the workflows blocked all later base approvals."""

    DIGEST = 'sha256:' + 'a' * 64
    NEW = 'sha256:' + 'b' * 64

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.repo = self.dir / 'repo'
        for d in ('ci', 'scripts', 'policy', '.github'):
            shutil.copytree(ROOT / d, self.repo / d, ignore=shutil.ignore_patterns('__pycache__'))
        (self.repo / 'catalog').mkdir()
        self.pin(self.DIGEST)
        self.bin = self.dir / 'bin'
        self.bin.mkdir()
        make_executable(self.bin / 'crane', '#!/bin/sh\ncase "$1" in\n digest) case "$2" in *approved*) echo "$FAKE_APPROVED";; '
                                            '*) echo "$FAKE_PINNED";; esac;;\n *) exit 42;;\nesac\n')
        make_executable(self.bin / 'cosign', '#!/bin/sh\ncase "$1" in verify-attestation) cat "$FAKE_ENVELOPE";; *) echo "{}";; esac\n')

    def tearDown(self):
        self.tmp.cleanup()

    def pin(self, digest):
        (self.repo / 'catalog/Dockerfile.temurin').write_text(f'FROM eclipse-temurin:21-jre-resolute@{digest}\n')

    def fingerprint(self):
        return fp.fingerprint(self.repo)

    def envelope(self, policy_sha256, version='2026-11-ghcr-v6'):
        ref = 'ghcr.io/acme/approved/eclipse-temurin@' + self.DIGEST
        predicate = {'schema': PTYPE, 'approved_ref': ref, 'policy_version': version, 'policy_sha256': policy_sha256,
                     'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'decision': 'REVIEW',
                     'approver': 'alice', 'decision_report_sha256': '2' * 64, 'evidence_sha256': {'decision.json': '2' * 64},
                     'git_commit': '3' * 40, 'build_url': 'https://github.com/o/r/actions/runs/1'}
        statement = {'predicateType': PTYPE, 'predicate': predicate,
                     'subject': [{'name': ref.split('@')[0], 'digest': {'sha256': 'a' * 64}}]}
        path = self.dir / 'envelope.json'
        path.write_text(json.dumps({'payloadType': 'application/vnd.in-toto+json',
                                    'payload': base64.b64encode(json.dumps(statement).encode()).decode()}) + '\n')
        return path

    def run_script(self, script, envelope, pinned=None):
        env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', GHCR_HOST='ghcr.io', GHCR_NAMESPACE='acme',
                   GHCR_APPROVED_REPO='ghcr.io/acme/approved/eclipse-temurin',
                   GHCR_QUARANTINE_REPO='ghcr.io/acme/quarantine/eclipse-temurin', APPROVAL_PUBKEY='k.pub',
                   APPROVAL_PREDICATE_TYPE=PTYPE, GITHUB_SHA='3' * 40, FAKE_APPROVED=self.DIGEST,
                   FAKE_PINNED=pinned or self.DIGEST, FAKE_ENVELOPE=str(envelope))
        return subprocess.run(['bash', f'ci/{script}'], cwd=self.repo, env=env, capture_output=True, text=True)

    def precheck(self, envelope):
        result = self.run_script('base_precheck.sh', envelope)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    # -- what the fingerprint covers --
    def test_application_side_changes_do_not_change_it(self):
        before = self.fingerprint()
        apps = json.loads((self.repo / 'policy/applications.json').read_text())
        apps['applications']['second-app'] = {'source_repo': 'o/second', 'dockerfile': 'Dockerfile', 'build_outputs': 'a.jar'}
        (self.repo / 'policy/applications.json').write_text(json.dumps(apps))
        config = json.loads((self.repo / 'policy/config.json').read_text())
        config['verification_max_age_minutes'] = 45
        config['critical_exceptions'] = [
            {'id': 'CVE-1', 'package': 'p', 'package_version': '1', 'platform': 'linux/amd64', 'expires': '2099-01-01',
             'reason': 'r', 'approved_by': 'a', 'image_ref': 'ghcr.io/acme/applications/app@' + self.DIGEST},
            {'id': 'CVE-2', 'package': 'p', 'package_version': '1', 'platform': 'linux/amd64', 'expires': '2099-01-01',
             'reason': 'r', 'approved_by': 'a', 'base_image_ref': 'ghcr.io/acme/approved/eclipse-temurin@' + self.DIGEST}]
        (self.repo / 'policy/config.json').write_text(json.dumps(config, indent=4))   # reformatting too
        for name in ('ci/application_pipeline.sh', 'scripts/check_application_vulnerabilities.py',
                     '.github/workflows/application-release.yml', '.github/workflows/security-pr.yml'):
            with open(self.repo / name, 'a') as f:
                f.write('\n# changed\n')
        self.assertEqual(before, self.fingerprint())

    def test_base_side_changes_change_it(self):
        before = self.fingerprint()
        for name in fp.BASE_FILES:
            with self.subTest(file=name):
                path = self.repo / name
                original = path.read_bytes()
                path.write_bytes(original + b'\n')
                self.assertNotEqual(before, self.fingerprint())
                path.write_bytes(original)
        config_path = self.repo / 'policy/config.json'
        original = config_path.read_text()
        for change in ({'review_new_high': False},
                       {'critical_exceptions': [{'id': 'CVE-3', 'package': 'p', 'package_version': '1',
                                                 'platform': 'linux/amd64', 'expires': '2099-01-01', 'reason': 'r',
                                                 'approved_by': 'a',
                                                 'image_ref': 'ghcr.io/acme/quarantine/eclipse-temurin@' + self.NEW}]}):
            with self.subTest(change=list(change)):
                config_path.write_text(json.dumps(dict(json.loads(original), **change)))
                self.assertNotEqual(before, self.fingerprint())
        config_path.write_text(original)
        self.assertEqual(before, self.fingerprint())
        (self.repo / 'scripts/inventory_fs.py').unlink()
        with self.assertRaisesRegex(ValueError, 'fingerprinted file missing'):
            self.fingerprint()

    def test_fingerprinted_file_list_is_closed_under_references(self):
        listed = set(fp.BASE_FILES)
        names = {pathlib.PurePosixPath(n).name: n for n in
                 [p.relative_to(ROOT).as_posix() for d in ('ci', 'scripts') for p in (ROOT / d).iterdir() if p.is_file()]}
        for relative in fp.BASE_FILES:
            text = (ROOT / relative).read_text()
            code = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))
            referenced = {names[m] for m in re.findall(r'[\w.-]+\.(?:py|sh|json)', code) if m in names}
            referenced |= {names[m + '.py'] for m in re.findall(r'(?m)^(?:from|import) (\w+)', code) if m + '.py' in names}
            self.assertLessEqual(referenced, listed, f'{relative} uses files outside the fingerprint')

    # -- where it is checked --
    def test_only_the_precheck_demands_the_current_fingerprint(self):
        self.assertIn('--expected-policy-sha256', (ROOT / 'ci/base_precheck.sh').read_text())
        self.assertNotIn('--expected-policy-sha256', (ROOT / 'ci/base_evaluate.sh').read_text())
        # New application builds must use only approvals with today's fingerprint.
        self.assertIn('--expected-policy-sha256', (ROOT / 'scripts/verify_bases.sh').read_text())
        self.assertIn('--field accepted_versions', (ROOT / 'scripts/verify_bases.sh').read_text())
        promote = (ROOT / 'ci/base_promote.sh').read_text()
        self.assertEqual(promote.count('--expected-policy-sha256'), 1)          # only for the NEW record
        self.assertLess(promote.index('cosign attest'), promote.index('--expected-policy-sha256'))

    def test_precheck_skips_only_with_the_current_fingerprint(self):
        envelope = self.envelope(self.fingerprint())
        self.assertEqual(self.precheck(envelope), 'approved')
        with open(self.repo / 'policy/applications.json', 'a') as f:
            f.write('\n')
        with open(self.repo / 'ci/application_pipeline.sh', 'a') as f:
            f.write('\n# app change\n')
        self.assertEqual(self.precheck(envelope), 'approved')        # application-side change: still skipped
        with open(self.repo / 'scripts/evaluate.py', 'a') as f:
            f.write('\n# gate change\n')
        self.assertEqual(self.precheck(envelope), 'needed')          # base-side change: evaluate again

    def test_evaluate_accepts_a_baseline_approved_by_older_code(self):
        """The v4 dead end: baseline signed under fingerprint X, tree now has fingerprint Y."""
        envelope = self.envelope('1' * 64, version='2026-11-ghcr-v4')
        self.pin(self.NEW)
        result = self.run_script('base_evaluate.sh', envelope, pinned=self.NEW)
        # The stub crane exits 42 at the first `crane manifest`, i.e. AFTER the baseline was accepted.
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertNotIn('policy content hash', result.stderr + result.stdout)

    def test_evaluate_still_rejects_an_unaccepted_policy_version(self):
        envelope = self.envelope(self.fingerprint(), version='2026-11-ghcr-v3')
        self.pin(self.NEW)
        result = self.run_script('base_evaluate.sh', envelope, pinned=self.NEW)
        self.assertEqual(result.returncode, 1)
        self.assertIn('not in accepted versions', result.stderr + result.stdout)


class Finding5SettingsAuditTests(unittest.TestCase):
    def good(self):
        return Finding13RepositorySettingsAuditTests().good()

    def main_ruleset(self, **extra):
        ruleset = {'name': 'protect main', 'target': 'branch', 'enforcement': 'active',
                   'conditions': {'ref_name': {'include': ['~DEFAULT_BRANCH'], 'exclude': []}},
                   'rules': [{'type': 'pull_request', 'parameters': {'required_approving_review_count': 1,
                                                                    'dismiss_stale_reviews_on_push': True}},
                             {'type': 'required_status_checks',
                              'parameters': {'required_status_checks': [{'context': 'unit-tests'}]}},
                             {'type': 'deletion'}]}
        ruleset.update(extra)
        return ruleset

    def test_good_settings_and_ruleset_alternative_pass(self):
        self.assertEqual(audit.audit(self.good()), [])
        s = self.good()
        s.pop('main_branch_protection')
        s['rulesets'].append(self.main_ruleset(bypass_actors=[]))
        self.assertEqual(audit.audit(s), [])

    def test_unreadable_bypass_list_is_not_evidence(self):
        s = self.good()
        s.pop('main_branch_protection')
        s['rulesets'].append(self.main_ruleset())            # API answer without bypass_actors
        failures = audit.audit(s)
        self.assertTrue(any('main branch update protection missing' in f and 'not readable' in f for f in failures))
        s = self.good()
        for ruleset in s['rulesets']:
            del ruleset['bypass_actors']
        self.assertEqual(sum('restricts creating' in f for f in audit.audit(s)), 2)

    def test_creation_rulesets_bypassable_by_writers_fail(self):
        for actor in ({'actor_id': 4, 'actor_type': 'RepositoryRole'}, {'actor_id': 2, 'actor_type': 'RepositoryRole'},
                      {'actor_id': 9, 'actor_type': 'SomethingNew'}):
            s = self.good()
            for ruleset in s['rulesets']:
                ruleset['bypass_actors'] = [actor]
            with self.subTest(actor=actor):
                self.assertEqual(sum('restricts creating' in f for f in audit.audit(s)), 2)

    def test_admin_bypass_passes_and_teams_are_listed_for_manual_review(self):
        s = self.good()
        for ruleset in s['rulesets']:
            ruleset['bypass_actors'] = [{'actor_id': 1, 'actor_type': 'OrganizationAdmin'},
                                        {'actor_id': 77, 'actor_type': 'Team'}]
        self.assertEqual(audit.audit(s), [])
        notes = audit.bypass_notes(s)
        self.assertEqual(len(notes), 2)
        self.assertIn('Team 77', notes[0])

    def test_classic_protection_with_bypass_allowance_fails(self):
        s = self.good()
        s['main_branch_protection']['required_pull_request_reviews']['bypass_pull_request_allowances'] = {
            'users': [{'login': 'dev'}], 'teams': [], 'apps': []}
        self.assertTrue(any('main branch update protection missing' in f for f in audit.audit(s)))

    def test_protected_branches_only_environment_fails(self):
        s = self.good()
        s['environments']['ghcr-application-signing']['deployment_branch_policy'] = {
            'protected_branches': True, 'custom_branch_policies': False}
        self.assertTrue(any('ghcr-application-signing must allow exactly the main branch' in f for f in audit.audit(s)))


class Finding6AnalysisBudgetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.base = layer([('opt/java/a.so', 'file', b'x')])
        self.app = layer([('app/app.jar', 'file', b'j' * 4096)])
        self.tar = self.dir / 'image.tar'
        archive(self.tar, [self.base, self.app])
        self.base_config = {'rootfs': {'diff_ids': [self.base[1]]}}
        (self.dir / 'base.json').write_text(json.dumps(self.base_config))

    def tearDown(self):
        self.tmp.cleanup()

    def with_limit(self, name, value):
        old = getattr(additive, name)
        setattr(additive, name, value)
        self.addCleanup(setattr, additive, name, old)

    def test_each_budget_reports_not_additive_instead_of_failing(self):
        self.assertTrue(additive.analyse(self.tar, self.base_config)['additive'])
        for name, value in (('MAX_LAYER_ENTRIES', 0), ('MAX_LAYER_UNCOMPRESSED', 1024),
                            ('MAX_TOTAL_ENTRIES', 1), ('MAX_PATH_LENGTH', 3)):
            with self.subTest(limit=name):
                old = getattr(additive, name)
                setattr(additive, name, value)
                try:
                    report = additive.analyse(self.tar, self.base_config)
                finally:
                    setattr(additive, name, old)
                self.assertFalse(report['additive'])
                self.assertTrue(report['violations'][0].startswith('cannot analyse layers:'))

    def test_command_exits_zero_and_writes_the_report(self):
        result = subprocess.run(
            [sys.executable, '-I', '-c',
             'import sys, runpy; sys.path.insert(0, sys.argv[1]); import check_additive_layers as m; '
             'm.MAX_LAYER_ENTRIES = 0; sys.argv = ["x", sys.argv[2], "--base-config", sys.argv[3], "--output", sys.argv[4]]; m.main()',
             str(ROOT / 'ci'), str(self.tar), str(self.dir / 'base.json'), str(self.dir / 'report.json')],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(json.loads((self.dir / 'report.json').read_text())['additive'])

    def test_malformed_input_still_fails(self):
        archive(self.tar, [self.base, self.app], diff_ids=[self.base[1], 'sha256:' + '0' * 64])
        with self.assertRaisesRegex(ValueError, 'does not match diff_id'):
            additive.analyse(self.tar, self.base_config)
        self.assertFalse(issubclass(ValueError, additive.BudgetExceeded))


class Finding7DiffociFailureTests(unittest.TestCase):
    """diffoci 0.1.8 exits 1 for 'differences found' AND for a failed pull."""

    STUBS = {
        'crane': '#!/usr/bin/env bash\ncase "$1" in\n  config) echo \'{"config":{}}\' ;;\n  export) cat "$STUB_TAR" ;;\n  *) exit 3 ;;\nesac\n',
        'syft': '#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in syft-json=*) echo \'{"artifacts":[]}\' > "${a#syft-json=}" ;; esac; done\n',
        'grype': '#!/usr/bin/env bash\necho \'{"matches":[]}\'\n',
        'diffoci': '#!/usr/bin/env bash\nprintf "%s" "$DIFFOCI_OUT"\nprintf "%s\\n" "$DIFFOCI_ERR" >&2\nexit "$DIFFOCI_RC"\n',
    }

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        (self.dir / 'bin').mkdir()
        for name, body in self.STUBS.items():
            make_executable(self.dir / 'bin' / name, body)
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w') as tf:
            info = tarfile.TarInfo('usr/bin/java')
            info.mode, info.size = 0o755, 4
            tf.addfile(info, io.BytesIO(b'java'))
        (self.dir / 'image.tar').write_bytes(buf.getvalue())

    def tearDown(self):
        self.tmp.cleanup()

    def compare(self, rc, out, err=''):
        env = dict(os.environ, PATH=f'{self.dir / "bin"}:{os.environ["PATH"]}', STUB_TAR=str(self.dir / 'image.tar'),
                   OLD_REF='h/approved/x@sha256:' + 'a' * 64, CANDIDATE_REF='h/quarantine/x@sha256:' + 'b' * 64,
                   PLATFORMS='linux/amd64', REPORT_DIR=str(self.dir / 'reports'),
                   DIFFOCI_RC=str(rc), DIFFOCI_OUT=out, DIFFOCI_ERR=err)
        return subprocess.run(['bash', str(ROOT / 'scripts/compare.sh')], env=env, cwd=self.dir,
                              capture_output=True, text=True)

    def test_differences_and_identical_images_pass(self):
        self.assertEqual(self.compare(1, 'TYPE NAME INPUT-0 INPUT-1\nFile etc/x a b\n', 'level=info msg="pulling"').returncode, 0)
        self.assertEqual(self.compare(0, '').returncode, 0)

    def test_failed_run_with_exit_1_is_a_failure(self):
        fatal = 'time="2026-11-18T17:14:39+01:00" level=fatal msg="failed to pull: unauthorized"'
        result = self.compare(1, '', fatal)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('diffoci failed for linux/amd64', result.stderr)
        self.assertNotEqual(self.compare(1, '').returncode, 0)                    # exit 1 without any table
        self.assertNotEqual(self.compare(1, 'partial table\n', fatal).returncode, 0)
        self.assertNotEqual(self.compare(2, 'x\n').returncode, 0)


class Finding8PinnedCopyAndGhTests(unittest.TestCase):
    def test_no_skopeo_left(self):
        for path in list((ROOT / 'ci').iterdir()) + list(WF.glob('*.yml')) + list((ROOT / 'scripts').glob('*.sh')):
            if path.is_file():
                code = '\n'.join(line for line in path.read_text().splitlines() if not line.lstrip().startswith('#'))
                self.assertNotIn('skopeo', code, path.name)
        self.assertNotIn('skopeo', tools.PINNED)

    def run_copy(self, manifest_bytes, tag_digest, expected):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            (tmp / 'bin').mkdir()
            (tmp / 'manifest').write_bytes(manifest_bytes)
            make_executable(tmp / 'bin/crane', '#!/bin/sh\ncase "$1" in\n copy) echo "$2 $3" > "$STUB_DIR/copied";;\n'
                                               ' manifest) cat "$STUB_DIR/manifest";;\n digest) echo "$STUB_TAG_DIGEST";;\nesac\n')
            env = dict(os.environ, PATH=f'{tmp / "bin"}:{os.environ["PATH"]}', STUB_DIR=str(tmp), STUB_TAG_DIGEST=tag_digest)
            result = subprocess.run(
                ['bash', '-c', 'set -euo pipefail; source "$1"; copy_exact src@x ghcr.io/o/r tag "$2" "$3"', 'x',
                 str(ROOT / 'ci/common.sh'), expected, str(tmp / 'digest.txt')], env=env, capture_output=True, text=True)
            copied = (tmp / 'copied').read_text().strip() if (tmp / 'copied').exists() else None
            return result, copied

    def test_copy_exact_verifies_the_destination_bytes(self):
        manifest = b'{"schemaVersion":2}'
        digest = 'sha256:' + hashlib.sha256(manifest).hexdigest()
        result, copied = self.run_copy(manifest, digest, digest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(copied, 'src@x ghcr.io/o/r:tag')
        result, _ = self.run_copy(b'{"schemaVersion":2,"tampered":true}', digest, digest)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('manifest bytes hashing to', result.stderr)
        result, _ = self.run_copy(manifest, 'sha256:' + 'c' * 64, digest)          # tag points elsewhere
        self.assertNotEqual(result.returncode, 0)
        result, copied = self.run_copy(manifest, digest, 'not-a-digest')
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(copied)

    def test_three_copies_use_it(self):
        for script, count in (('base_quarantine.sh', 1), ('base_promote.sh', 1), ('application_pipeline.sh', 1)):
            self.assertEqual(len(re.findall(r'(?m)^\s*copy_exact ', (ROOT / 'ci' / script).read_text())), count)

    def test_gh_is_pinned_and_new_enough_for_attestation_verification(self):
        version = tuple(int(x) for x in LOCK['tools']['gh']['version'].lstrip('v').split('.'))
        self.assertGreaterEqual(version, (2, 97, 0))
        for kind in ('scan', 'push', 'promote', 'api', 'base'):
            self.assertIn('gh', tools.NEEDS[kind])

    def require(self, kind, on_path, verified, github_actions='true'):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            for directory, names in (('host', on_path.get('host', ())), ('verified', on_path.get('verified', ()))):
                (tmp / directory).mkdir()
                for name in names:
                    make_executable(tmp / directory / name, '#!/bin/sh\n')
            env = {'PATH': f'{tmp / "verified"}:{tmp / "host"}:{os.path.dirname(sys.executable)}:/usr/bin:/bin',
                   'GITHUB_ACTIONS': github_actions}
            if verified:
                env['VERIFIED_TOOLS_DIR'] = str(tmp / 'verified')
            return subprocess.run(['bash', str(ROOT / 'ci/require_tools.sh'), kind], env=env, capture_output=True, text=True)

    def test_require_tools_refuses_host_copies_of_pinned_tools(self):
        ok = self.require('push', {'verified': ('crane', 'gh')}, verified=True)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        host_gh = self.require('push', {'verified': ('crane',), 'host': ('gh',)}, verified=True)
        self.assertNotEqual(host_gh.returncode, 0)
        self.assertIn('Refusing an unpinned host tool', host_gh.stderr)
        missing = self.require('rescan', {'verified': ('crane',)}, verified=True)
        self.assertIn('Missing grype', missing.stderr)
        no_installer = self.require('push', {'host': ('crane', 'gh')}, verified=False)
        self.assertIn('did not run', no_installer.stderr)
        self.assertNotEqual(no_installer.returncode, 0)
        local = self.require('push', {'host': ('crane', 'gh')}, verified=False, github_actions='')
        self.assertEqual(local.returncode, 0, local.stderr)          # local runs: presence only, with a warning
        self.assertIn('WARNING', local.stderr)

    def test_require_tools_list_comes_from_the_installer(self):
        for kind in ('base', 'promote', 'image-build', 'scan', 'push', 'rescan'):
            listed = subprocess.run([sys.executable, '-I', str(ROOT / 'ci/install_verified_tools.py'), '--kind', kind,
                                     '--list'], capture_output=True, text=True, check=True).stdout.split()
            self.assertEqual(set(listed), tools.NEEDS[kind])
        self.assertIn('install_verified_tools.py" --kind "$kind" --list', (ROOT / 'ci/require_tools.sh').read_text())


class Finding10BuildRecordReferenceTests(unittest.TestCase):
    """Found while running the sign job for real: the build record only accepted Harbor-shaped
    references (host/applications/app), so every GHCR release failed in the sign job."""

    DIGEST = 'sha256:' + 'd' * 64
    CANDIDATE = 'ghcr.io/acme/application-candidates/myapp'
    RELEASE = 'ghcr.io/acme/applications/myapp'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.module = load('v5_build_record', 'scripts/create_application_build_record.py')
        d = self.dir / 'publish-evidence'
        d.mkdir()
        base = 'ghcr.io/acme/approved/eclipse-temurin@sha256:' + 'b' * 64
        manifest = json.dumps({'schema': 'https://example.org/verified-build-artifacts/v1',
                               'files': [{'path': 'target/app.jar', 'sha256': 'a' * 64, 'size': 1}]}).encode()
        (self.dir / 'manifest.json').write_bytes(manifest)
        files = {'pushed-ref.txt': f'{self.CANDIDATE}@{self.DIGEST}\n', 'approved-ref.txt': f'{self.RELEASE}@{self.DIGEST}\n',
                 'config-digest.txt': 'sha256:' + 'c' * 64 + '\n', 'platform.txt': 'linux/amd64\n',
                 'app-sbom.json': json.dumps({'bomFormat': 'CycloneDX'}), 'base-images.txt': base + '\n',
                 'final-base.txt': base + '\n', 'artifact-manifest-sha256.txt': hashlib.sha256(manifest).hexdigest() + '\n',
                 'vulnerability-decision.json': json.dumps({'decision': 'PASS', 'image_ref': f'{self.CANDIDATE}@{self.DIGEST}',
                                                            'release_ref': f'{self.RELEASE}@{self.DIGEST}',
                                                            'platform': 'linux/amd64', 'base_image_ref': base}),
                 'independent-verification.json': json.dumps({'highApproval': None}),
                 'independent-verification.sig': 'sig', 'independent-grype.json': '{}'}
        for name, text in files.items():
            (d / name).write_text(text)
        (self.dir / 'authorization.json').write_text('{}')

    def tearDown(self):
        self.tmp.cleanup()

    def args(self, **changes):
        import argparse
        values = dict(directory=str(self.dir / 'publish-evidence'), app_commit='a' * 40,
                      source_repository='https://github.com/acme/myapp.git',
                      build_job='acme/sec/.github/workflows/application-release.yml',
                      schema='https://example.org/github-actions-build-record/v1',
                      release_authorization=str(self.dir / 'authorization.json'),
                      artifact_manifest=str(self.dir / 'manifest.json'),
                      build_url='https://github.com/acme/sec/actions/runs/1', output='unused',
                      release_repository=self.RELEASE, candidate_repository=self.CANDIDATE)
        values.update(changes)
        return argparse.Namespace(**values)

    def test_ghcr_reference_with_owner_is_accepted(self):
        record = self.module.create(self.args())
        self.assertEqual(record['image'], f'{self.RELEASE}@{self.DIGEST}')
        self.assertEqual(record['candidateImage'], f'{self.CANDIDATE}@{self.DIGEST}')
        self.assertEqual(record['imageConfigDigest'], 'sha256:' + 'c' * 64)

    def test_only_the_expected_repositories_are_accepted(self):
        for changes, message in (
                ({'release_repository': 'ghcr.io/acme/applications/other'}, 'release reference|expected application release'),
                ({'candidate_repository': 'ghcr.io/acme/application-candidates/other'}, 'unexpected immutable'),
                ({'release_repository': self.CANDIDATE}, 'must differ'),
                ({'release_repository': 'ghcr.io/acme/applications/my app'}, 'invalid release repository')):
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(ValueError, message):
                    self.module.create(self.args(**changes))
        (self.dir / 'publish-evidence/approved-ref.txt').write_text(f'{self.RELEASE}@sha256:' + 'e' * 64)
        with self.assertRaisesRegex(ValueError, 'does not match verified candidate'):
            self.module.create(self.args())

    def test_pipeline_passes_both_repositories(self):
        self.assertIn('--release-repository "$APP_RELEASE_REPO" --candidate-repository "$APP_CANDIDATE_REPO"',
                      (ROOT / 'ci/application_pipeline.sh').read_text())


class Finding9DocumentationTests(unittest.TestCase):
    def test_versions_in_docs_and_examples_match_the_policy(self):
        policy = json.loads((ROOT / 'policy/config.json').read_text())
        example = (ROOT / 'examples/release-approval-predicate.json.example').read_text()
        self.assertIn(f'"policyVersion": "{policy["version"]}"', example)
        migration = (ROOT / 'docs/MIGRATION-FROM-HARBOR.md').read_text()
        self.assertIn(f'`{policy["version"]}` (current)', migration)
        self.assertNotIn('`2026-11-ghcr-v3` (current)', migration)
        self.assertNotIn('only accepts `2026-11-ghcr-v4`', migration)
        self.assertTrue((ROOT / 'README.md').read_text().startswith(
            '# GitHub Actions + GitHub Container Registry (GHCR) image approval — v6'))

    def test_docs_do_not_ask_for_removed_steps(self):
        for name in ('README.md', 'docs/SETUP.md', 'docs/V4-HARDENING.md'):
            text = (ROOT / name).read_text()
            self.assertNotIn('REPLACE_WITH', text)
            self.assertNotRegex(text, r'(?i)populate \*\*crane\*\*|supplying independently checked release asset URLs')
        self.assertIn('Bypass lists ARE judged', (ROOT / 'ci/audit_repo_settings.py').read_text())

    def test_changes_file_has_a_v5_section_covering_every_finding(self):
        changes = (ROOT / 'CHANGES.md').read_text()
        self.assertTrue(changes.startswith('# v6 fixes'))
        self.assertIn('# Changes in v5', changes)
        v5 = changes.split('# Changes in v5', 1)[1].split('\n# v4 changes', 1)[0]
        for n in range(1, 11):
            self.assertRegex(v5, rf'(?m)^{n}\. \*\*')


if __name__ == '__main__':
    unittest.main()
