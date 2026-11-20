"""Regression tests for the proof-of-concept changes (see README.md, "PoC changes").

  * self-approval switch (policy/config.json `allow_self_approval`, ci/environment_approver.py)
  * settings audit relaxed for a solo maintainer (ci/audit_repo_settings.py)
  * first-baseline bootstrap (scripts/approval_record.py --bootstrap, ci/bootstrap_base.sh,
    .github/workflows/base-bootstrap.yml), run end to end against stub crane/cosign and fed
    into the real precheck and application base verification.
"""
import base64
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / '.github/workflows'
PTYPE = 'https://example.org/ghcr-base-approval/v1'
try:
    import yaml
except ImportError:
    yaml = None


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


approver = load('poc_approver', 'ci/environment_approver.py')
audit = load('poc_audit', 'ci/audit_repo_settings.py')
record = load('poc_record', 'scripts/approval_record.py')
attestation = load('poc_attestation', 'scripts/check_approval_attestation.py')
fp = load('poc_fp', 'scripts/policy_fingerprint.py')


def approvals(*items):
    return [{'state': 'approved', 'user': {'login': login}, 'environments': [{'name': env}]}
            for login, env in items]


class SelfApprovalSwitchTests(unittest.TestCase):
    ENV = 'base-manual-approval'

    def test_shipped_policy_states_it_and_it_is_fingerprinted(self):
        # Either value is fine (turning it off must not break this suite); it must be explicit.
        config = json.loads((ROOT / 'policy/config.json').read_text())
        self.assertIsInstance(config['allow_self_approval'], bool)
        self.assertIs(approver.self_approval_allowed(ROOT / 'policy/config.json'), config['allow_self_approval'])
        self.assertNotIn('allow_self_approval', fp.APPLICATION_ONLY_KEYS)
        flipped = dict(config, allow_self_approval=not config['allow_self_approval'])
        self.assertNotEqual(fp.base_policy_view(config), fp.base_policy_view(flipped))

    def test_self_approval_is_labelled_not_hidden(self):
        data = approvals(('Stefan', self.ENV))
        self.assertEqual(approver.approver(data, self.ENV, 'stefan', 'stefan', allow_self=True), 'self:Stefan')
        self.assertEqual(approver.approver(data, self.ENV, 'other', 'stefan', allow_self=True), 'self:Stefan')
        with self.assertRaisesRegex(ValueError, 'cannot approve'):
            approver.approver(data, self.ENV, 'stefan', 'stefan')                 # default stays strict

    def test_switch_changes_nothing_else(self):
        self.assertEqual(approver.approver(approvals(('alice', self.ENV)), self.ENV, 'bob', 'bob', allow_self=True),
                         'alice')
        for data in (approvals(('alice', 'ghcr-application-signing')),
                     approvals(('alice', self.ENV), ('bob', self.ENV))):
            with self.subTest(data=data), self.assertRaises(ValueError):
                approver.approver(data, self.ENV, 'bob', 'bob', allow_self=True)

    def test_policy_value_must_be_boolean(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'config.json'
            for value, expected in ((True, True), (False, False), (None, ValueError), ('true', ValueError)):
                with self.subTest(value=value):
                    path.write_text(json.dumps({'version': 'x', 'allow_self_approval': value}))
                    if expected is ValueError:
                        with self.assertRaises(ValueError):
                            approver.self_approval_allowed(path)
                    else:
                        self.assertIs(approver.self_approval_allowed(path), expected)
            path.write_text(json.dumps({'version': 'x'}))
            self.assertIs(approver.self_approval_allowed(path), False)               # absent: strict

    def test_cli_reads_the_policy(self):
        with tempfile.TemporaryDirectory() as tmp:
            policy = pathlib.Path(tmp) / 'config.json'
            stdin = json.dumps(approvals(('stefan', self.ENV)))
            cmd = ['python3', '-I', str(ROOT / 'ci/environment_approver.py'), '--environment', self.ENV,
                   '--triggering-actor', 'stefan', '--actor', 'stefan', '--policy', str(policy)]
            policy.write_text(json.dumps({'allow_self_approval': True}))
            result = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
            self.assertEqual((result.returncode, result.stdout.strip()), (0, 'self:stefan'), result.stderr)
            policy.write_text(json.dumps({'allow_self_approval': False}))
            result = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('cannot approve', result.stderr)
            policy.unlink()                                                          # unreadable: refuse
            self.assertNotEqual(subprocess.run(cmd, input=stdin, capture_output=True, text=True).returncode, 0)

    def test_self_label_is_accepted_as_high_finding_approver(self):
        vulns = load('poc_vulns', 'scripts/check_application_vulnerabilities.py')
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'high-approval.json'
            path.write_text(json.dumps({'approver': 'self:stefan', 'findings': [['CVE-1', 'p', '1']]}))
            self.assertEqual(vulns.load_approved_high(path)[0], 'self:stefan')


class SoloAuditTests(unittest.TestCase):
    def solo(self):
        envs = {}
        for name in audit.ENVIRONMENTS:
            env = {'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True},
                   'protection_rules': []}
            if name in audit.REVIEWER_ENVIRONMENTS:
                env['protection_rules'] = [{'type': 'required_reviewers', 'prevent_self_review': False,
                                            'reviewers': [{'type': 'User'}]}]
            envs[name] = env
        creation = [{'name': f'restrict {t} creation', 'target': t, 'enforcement': 'active',
                     'conditions': {'ref_name': {'include': ['~ALL'], 'exclude': []}},
                     'bypass_actors': [{'actor_id': 5, 'actor_type': 'RepositoryRole', 'bypass_mode': 'always'}],
                     'rules': [{'type': 'creation'}]} for t in ('branch', 'tag')]
        main = {'name': 'protect main', 'target': 'branch', 'enforcement': 'active', 'bypass_actors': [],
                'conditions': {'ref_name': {'include': ['~DEFAULT_BRANCH'], 'exclude': []}},
                'rules': [{'type': 'pull_request', 'parameters': {'required_approving_review_count': 0}},
                          {'type': 'required_status_checks',
                           'parameters': {'required_status_checks': [{'context': 'unit-tests'}]}},
                          {'type': 'deletion'}]}
        return {'workflow_permissions': {'default_workflow_permissions': 'read',
                                         'can_approve_pull_request_reviews': False},
                'environments': envs,
                'branch_policies': {n: [{'name': 'main', 'type': 'branch'}] for n in audit.ENVIRONMENTS},
                'rulesets': creation + [main]}

    def test_solo_settings_pass_only_with_the_switch(self):
        self.assertEqual(audit.audit(self.solo(), allow_self_approval=True), [])
        strict = audit.audit(self.solo())
        self.assertTrue(any('Prevent self-review' in f for f in strict))
        self.assertTrue(any('main branch update protection missing' in f for f in strict))

    def test_everything_else_is_still_required(self):
        def without(fn):
            s = self.solo()
            fn(s)
            return audit.audit(s, allow_self_approval=True)
        main = -1
        cases = {
            'needs required reviewers': lambda s: s['environments']['base-manual-approval'].update(protection_rules=[]),
            'read-only': lambda s: s['workflow_permissions'].update(default_workflow_permissions='write'),
            'exactly the main': lambda s: s['branch_policies'].update({'ghcr-read-only': [{'name': '*', 'type': 'branch'}]}),
            'main branch update protection missing': lambda s: s['rulesets'][main].update(
                rules=[r for r in s['rulesets'][main]['rules'] if r['type'] != 'pull_request']),
            'main branch update protection missing ': lambda s: s['rulesets'][main].update(
                rules=[r for r in s['rulesets'][main]['rules'] if r['type'] != 'required_status_checks']),
            'main branch update protection missing  ': lambda s: s['rulesets'][main].update(
                bypass_actors=[{'actor_id': 5, 'actor_type': 'RepositoryRole', 'bypass_mode': 'always'}]),
            'restricts creating': lambda s: s['rulesets'][0].update(enforcement='evaluate'),
        }
        for fragment, fn in cases.items():
            with self.subTest(fragment=fragment):
                failures = without(fn)
                self.assertTrue(any(fragment.strip() in f for f in failures), failures)

    def test_stale_review_dismissal_stays_required_with_approvals(self):
        s = self.solo()
        s['rulesets'][-1]['rules'][0]['parameters'] = {'required_approving_review_count': 1}
        self.assertTrue(any('main branch update protection missing' in f
                            for f in audit.audit(s, allow_self_approval=True)))
        s['rulesets'][-1]['rules'][0]['parameters']['dismiss_stale_reviews_on_push'] = True
        self.assertEqual(audit.audit(s, allow_self_approval=True), [])

    def test_classic_branch_protection_alternative(self):
        def classic(**reviews):
            s = self.solo()
            s['rulesets'].pop()                                   # no main ruleset: classic protection only
            s['main_branch_protection'] = {
                'required_status_checks': {'checks': [{'context': 'unit-tests'}]},
                'enforce_admins': {'enabled': True},
                'allow_force_pushes': {'enabled': False}, 'allow_deletions': {'enabled': False}}
            s['main_branch_protection']['required_pull_request_reviews'] = reviews
            return s
        self.assertEqual(audit.audit(classic(required_approving_review_count=0), allow_self_approval=True), [])
        self.assertTrue(audit.audit(classic(required_approving_review_count=0)))            # strict: refused
        self.assertTrue(audit.audit(classic(required_approving_review_count=1), allow_self_approval=True))
        self.assertEqual(audit.audit(classic(required_approving_review_count=1, dismiss_stale_reviews=True),
                                     allow_self_approval=True), [])
        no_pr = classic()
        del no_pr['main_branch_protection']['required_pull_request_reviews']
        self.assertTrue(any('main branch update protection missing' in f
                            for f in audit.audit(no_pr, allow_self_approval=True)))

    def test_note_is_printed(self):
        self.assertEqual(audit.self_approval_notes(False), [])
        self.assertIn('self:<login>', audit.self_approval_notes(True)[0])


class BootstrapRecordTests(unittest.TestCase):
    REF = 'ghcr.io/acme/approved/eclipse-temurin@sha256:' + 'a' * 64

    def make(self, decision='REVIEW', bootstrap=True, approver_id='self:stefan'):
        tmp = pathlib.Path(self.enterContext(tempfile.TemporaryDirectory()))
        (tmp / 'decision.json').write_text(json.dumps({'decision': decision, 'policy_version': '2026-11-ghcr-v6'}))
        args = types.SimpleNamespace(decision_file=str(tmp / 'decision.json'), evidence_dir=str(tmp),
                                     upstream_ref='docker.io/library/eclipse-temurin:21@sha256:' + 'a' * 64,
                                     approved_ref=self.REF, approver=approver_id,
                                     build_url='https://github.com/o/r/actions/runs/1', git_commit='3' * 40,
                                     predicate_type=PTYPE, output=str(tmp / 'out.json'), bootstrap=bootstrap)
        return record.build_record(args)

    @staticmethod
    def as_attestation(predicate):
        statement = {'predicateType': PTYPE, 'predicate': predicate,
                     'subject': [{'name': BootstrapRecordTests.REF.split('@')[0], 'digest': {'sha256': 'a' * 64}}]}
        return json.dumps({'payloadType': 'application/vnd.in-toto+json',
                           'payload': base64.b64encode(json.dumps(statement).encode()).decode()})

    def test_record_is_marked_and_has_no_fingerprint(self):
        predicate = self.make()
        self.assertIs(predicate['bootstrap'], True)
        self.assertNotIn('policy_sha256', predicate)
        self.assertIn('policy_sha256', self.make(bootstrap=False))
        self.assertNotIn('bootstrap', self.make(bootstrap=False))

    def test_only_a_reviewed_decision_can_be_bootstrapped(self):
        with self.assertRaisesRegex(ValueError, 'bootstrap baseline must be'):
            self.make(decision='AUTO_PASS', approver_id='automatic-policy')
        with self.assertRaisesRegex(ValueError, 'no human approver'):
            self.make(approver_id='')

    def test_normal_approval_next_to_the_bootstrap_record_is_consumable(self):
        """After the first normal approval the digest carries BOTH records (runbook steps 4, 7)."""
        text = self.as_attestation(self.make()) + '\n' + self.as_attestation(self.make(bootstrap=False))
        chosen = attestation.check(text, PTYPE, 'sha256:' + 'a' * 64, self.REF, '2026-11-ghcr-v6',
                                   max_age_hours=720, expected_policy_sha256=fp.fingerprint())
        self.assertNotIn('bootstrap', chosen)
        self.assertEqual(chosen['policy_sha256'], fp.fingerprint())

    def test_baseline_yes_consumable_no(self):
        text = self.as_attestation(self.make())
        digest = 'sha256:' + 'a' * 64
        attestation.check(text, PTYPE, digest, self.REF, '2026-11-ghcr-v6,2026-11-ghcr-v5', max_age_hours=8760)
        with self.assertRaisesRegex(ValueError, 'policy content hash'):
            attestation.check(text, PTYPE, digest, self.REF, '2026-11-ghcr-v6', max_age_hours=720,
                              expected_policy_sha256=fp.fingerprint())


CRANE_STUB = r'''#!/usr/bin/env python3
import os, pathlib, sys
state = pathlib.Path(os.environ['FAKE_STATE'])
pinned, args = os.environ['FAKE_PINNED'], sys.argv[1:]
cmd = args[0]
if cmd == 'digest':
    ref = args[1]
    if ref.endswith(':21-jre-resolute') and '/approved/' in ref:
        if os.environ.get('FAKE_EXISTING'):
            print(os.environ['FAKE_EXISTING']); sys.exit(0)
        if (state / 'tagged').exists():
            print(pinned); sys.exit(0)
        print('MANIFEST_UNKNOWN', file=sys.stderr); sys.exit(1)
    print(pinned)
elif cmd == 'ls':
    if os.environ.get('FAKE_LS_FAILS'):
        print('transient registry error', file=sys.stderr); sys.exit(1)
    if (state / 'copied').exists():
        print('bootstrap-' + pinned[7:])
    if (state / 'tagged').exists() or os.environ.get('FAKE_LS_HAS_TAG'):
        print('21-jre-resolute')
elif cmd == 'manifest':
    sys.stdout.buffer.write((state / 'index.json').read_bytes())
elif cmd == 'copy':
    (state / 'copied').write_text(' '.join(args[1:]))
elif cmd == 'tag':
    (state / 'tagged').write_text(' '.join(args[1:]))
else:
    sys.exit(42)
'''

COSIGN_STUB = r'''#!/usr/bin/env python3
import base64, json, os, pathlib, sys
state = pathlib.Path(os.environ['FAKE_STATE'])
args = sys.argv[1:]
if args[0] == 'attest':
    predicate = json.loads(pathlib.Path(args[args.index('--predicate') + 1]).read_text())
    ref = args[-1]
    statement = {'predicateType': args[args.index('--type') + 1], 'predicate': predicate,
                 'subject': [{'name': ref.split('@')[0], 'digest': {'sha256': ref.split('@sha256:')[1]}}]}
    (state / 'envelope.json').write_text(json.dumps(
        {'payloadType': 'application/vnd.in-toto+json',
         'payload': base64.b64encode(json.dumps(statement).encode()).decode()}) + '\n')
elif args[0] == 'verify-attestation':
    sys.stdout.write((state / 'envelope.json').read_text())
elif args[0] in ('sign', 'verify'):
    (state / ('signed' if args[0] == 'sign' else 'verified')).touch()
    print('{}')
else:
    sys.exit(42)
'''


class BootstrapScriptTests(unittest.TestCase):
    """ci/bootstrap_base.sh end to end with stub registry tools, then the real precheck and
    application base verification against the record it produced."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.repo = self.dir / 'repo'
        for d in ('ci', 'scripts', 'policy', '.github', 'catalog'):
            shutil.copytree(ROOT / d, self.repo / d, ignore=shutil.ignore_patterns('__pycache__'))
        self.state = self.dir / 'state'
        self.state.mkdir()
        index = b'{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[]}'
        (self.state / 'index.json').write_bytes(index)
        self.digest = 'sha256:' + hashlib.sha256(index).hexdigest()
        (self.repo / 'catalog/Dockerfile.temurin').write_text(f'FROM eclipse-temurin:21-jre-resolute@{self.digest}\n')
        self.bin = self.dir / 'bin'
        self.bin.mkdir()
        for name, text in (('crane', CRANE_STUB), ('cosign', COSIGN_STUB)):
            (self.bin / name).write_text(text)
            (self.bin / name).chmod((self.bin / name).stat().st_mode | stat.S_IEXEC)
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', GHCR_HOST='ghcr.io',
                        GHCR_NAMESPACE='acme', GHCR_APPROVED_REPO='ghcr.io/acme/approved/eclipse-temurin',
                        GHCR_QUARANTINE_REPO='ghcr.io/acme/quarantine/eclipse-temurin', APPROVAL_PUBKEY='k.pub',
                        COSIGN_KEY='k.key', APPROVAL_PREDICATE_TYPE=PTYPE, GITHUB_SHA='3' * 40,
                        GITHUB_SERVER_URL='https://github.com', GITHUB_REPOSITORY='acme/security',
                        GITHUB_RUN_ID='7', APPROVER_ID='self:stefan', CONFIRM_DIGEST=self.digest,
                        FAKE_PINNED=self.digest, FAKE_STATE=str(self.state))
        self.env.pop('FAKE_EXISTING', None)

    def tearDown(self):
        self.tmp.cleanup()

    def run_bash(self, *args, **extra):
        return subprocess.run(['bash', *args], cwd=self.repo, env=dict(self.env, **extra),
                              capture_output=True, text=True)

    def predicate(self):
        statement = json.loads(base64.b64decode(json.loads((self.state / 'envelope.json').read_text())['payload']))
        return statement['predicate']

    def test_bootstrap_then_precheck_and_application_refuse_it(self):
        result = self.run_bash('ci/bootstrap_base.sh')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertTrue((self.state / 'signed').exists())
        self.assertIn(f'bootstrap-{self.digest[7:]}', (self.state / 'copied').read_text())
        self.assertIn('21-jre-resolute', (self.state / 'tagged').read_text())
        predicate = self.predicate()
        self.assertIs(predicate['bootstrap'], True)
        self.assertNotIn('policy_sha256', predicate)
        self.assertEqual(predicate['approver'], 'self:stefan')
        self.assertEqual(predicate['approved_ref'], 'ghcr.io/acme/approved/eclipse-temurin@' + self.digest)
        # The normal pipeline must still evaluate it ...
        precheck = self.run_bash('ci/base_precheck.sh')
        self.assertEqual((precheck.returncode, precheck.stdout.strip()), (0, 'needed'), precheck.stderr)
        self.assertIn('policy content hash', precheck.stderr)                # refused for THAT reason
        # ... and no application may build on it.
        bases = self.dir / 'bases.txt'
        bases.write_text(predicate['approved_ref'] + '\n')
        verify = self.run_bash('scripts/verify_bases.sh', str(bases), str(self.dir / 'evidence'))
        self.assertNotEqual(verify.returncode, 0)
        self.assertIn('policy content hash', verify.stderr + verify.stdout)

    def test_refuses_existing_baseline(self):
        result = self.run_bash('ci/bootstrap_base.sh', FAKE_EXISTING='sha256:' + 'b' * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('already points at', result.stderr)
        self.assertFalse((self.state / 'copied').exists())

    def test_failed_tag_lookup_is_not_proof_of_absence(self):
        """The tag lookup fails (as for a transient registry error) although a baseline exists:
        the tag list must stop the script before anything is signed or the tag is moved."""
        for extra, message in (({'FAKE_LS_HAS_TAG': '1'}, 'already exists'),
                               ({'FAKE_LS_FAILS': '1'}, 'transient registry error')):
            with self.subTest(extra=extra):
                result = self.run_bash('ci/bootstrap_base.sh', **extra)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
                self.assertFalse((self.state / 'signed').exists())
                self.assertFalse((self.state / 'tagged').exists())

    def test_refuses_unconfirmed_digest(self):
        result = self.run_bash('ci/bootstrap_base.sh', CONFIRM_DIGEST='sha256:' + 'c' * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('is not the catalog pin', result.stderr)
        self.assertFalse((self.state / 'copied').exists())

    def test_refuses_automatic_approver(self):
        result = self.run_bash('ci/bootstrap_base.sh', APPROVER_ID='automatic-policy')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.state / 'copied').exists())


@unittest.skipIf(yaml is None, 'PyYAML required')
class BootstrapWorkflowTests(unittest.TestCase):
    def test_wiring(self):
        text = (WF / 'base-bootstrap.yml').read_text()
        data = yaml.safe_load(text)
        on = data.get('on', data.get(True))
        self.assertEqual(set(on), {'workflow_dispatch'})
        self.assertEqual(data['permissions'], {'contents': 'read'})
        job = data['jobs']['bootstrap']
        self.assertEqual(job['environment'], 'base-manual-approval')
        self.assertEqual(job['if'], "github.ref == 'refs/heads/main'")
        self.assertEqual(job['permissions'], {'contents': 'read', 'actions': 'read', 'packages': 'write'})
        base = yaml.safe_load((WF / 'base-image-approval.yml').read_text())
        self.assertEqual(data['concurrency'], base['concurrency'])           # never races a base run
        self.assertIn('ci/environment_approver.py --environment base-manual-approval', text)
        self.assertIn('--triggering-actor "$GITHUB_TRIGGERING_ACTOR"', text)
        self.assertIn('bash ci/bootstrap_base.sh', text)
        self.assertEqual(text.count('${{ inputs.'), 1)                       # input reaches scripts via env only
        self.assertEqual(job['env']['CONFIRM_DIGEST'], '${{ inputs.confirm_digest }}')


if __name__ == '__main__':
    unittest.main()
