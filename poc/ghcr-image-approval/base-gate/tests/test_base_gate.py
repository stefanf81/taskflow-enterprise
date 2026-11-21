"""Tests for the CI base-image gate (base-gate/): plan, compare_all.sh, decide.

Needs python3, git and bash. compare_all.sh runs the kit's real scripts/compare.sh and
scripts/evaluate.py against stub crane/syft/grype/diffoci binaries.
"""
import datetime as dt
import io
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest

GATE = pathlib.Path(__file__).resolve().parents[1]
ROOT = GATE.parent
sys.path.insert(0, str(GATE))
import decide  # noqa: E402
import plan  # noqa: E402

A, B, C = ('sha256:' + ch * 64 for ch in 'abc')
TEMURIN = 'docker.io/library/eclipse-temurin'
APPROVED = 'ghcr.io/acme/approved/eclipse-temurin'


def catalog(digest):
    return f'# pinned\nFROM eclipse-temurin:21-jre-resolute@{digest}\n'


def app(*images):
    lines = [f'FROM {image}' + (f' AS stage{i}' if i < len(images) - 1 else '') for i, image in enumerate(images)]
    return '\n'.join(lines) + '\nCOPY --chmod=0444 target/app.jar /opt/app/app.jar\n'


class NormaliseTests(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(plan.normalise(f'eclipse-temurin:21-jre@{A}'), (TEMURIN, A))
        self.assertEqual(plan.normalise(f'docker.io/library/eclipse-temurin@{A}'), (TEMURIN, A))
        self.assertEqual(plan.normalise(f'{APPROVED}:21-jre-resolute@{B}'), (APPROVED, B))
        self.assertEqual(plan.normalise(f'acme/tool:1.2@{A}'), ('docker.io/acme/tool', A))
        self.assertEqual(plan.normalise(f'localhost:5000/x/y@{A}'), ('localhost:5000/x/y', A))

    def test_refused(self):
        for image in ('eclipse-temurin:21', f'x@sha256:{"a" * 10}', f'Upper/case@{A}', f'a//b@{A}',
                      f'x:bad tag@{A}'):
            with self.subTest(image=image), self.assertRaises(ValueError):
                plan.normalise(image)


class PinsTests(unittest.TestCase):
    def test_multi_stage_flags_and_continuations(self):
        text = (f'FROM --platform=$BUILDPLATFORM {APPROVED}@{A} AS build\n'
                f'FROM \\\n  docker.io/acme/tool@{B} AS tools\nFROM build\nFROM scratch\n')
        self.assertEqual(plan.pins(text, 'x'), {APPROVED: A, 'docker.io/acme/tool': B})

    def test_unpinned_and_variables_fail(self):
        for text in ('FROM eclipse-temurin:21\n', 'FROM $BASE\n', 'FROM\n'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                plan.pins(text, 'x')

    def test_same_repository_two_digests_fails(self):
        with self.assertRaises(ValueError):
            plan.pins(f'FROM {APPROVED}@{A} AS a\nFROM {APPROVED}@{B}\n', 'x')


class PlanTests(unittest.TestCase):
    """Runs a copy of plan.py inside a throwaway git repository with a real history."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.tmp.name)
        for rel in ('base-gate/plan.py', 'scripts/check_dockerfile_bases.py'):
            (self.repo / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / rel, self.repo / rel)
        self.git('init', '-q', '-b', 'main')
        self.write({'base-gate/config.json': json.dumps({'dockerfiles': ['catalog/Dockerfile.temurin',
                                                                         'example-app/Dockerfile'],
                                                         'acceptances': []}),
                    'catalog/Dockerfile.temurin': catalog(A),
                    'example-app/Dockerfile': app(f'{APPROVED}:21@{A}')})
        self.base = self.commit()

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@example.org', *args],
                              cwd=self.repo, check=True, capture_output=True, text=True).stdout.strip()

    def write(self, files):
        for rel, text in files.items():
            path = self.repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'c')
        return self.git('rev-parse', 'HEAD')

    def run_plan(self, base=None):
        return subprocess.run([sys.executable, '-I', 'base-gate/plan.py', '--base-rev', base or self.base],
                              cwd=self.repo, capture_output=True, text=True)

    def plan(self, base=None):
        result = self.run_plan(base)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_nothing_moved(self):
        result = self.plan()
        self.assertEqual(result['comparisons'], [])
        self.assertEqual({p['ref'] for p in result['unchanged']}, {f'{TEMURIN}@{A}', f'{APPROVED}@{A}'})

    def test_changed_pin_is_compared_with_main(self):
        self.write({'catalog/Dockerfile.temurin': catalog(B)})
        self.commit()
        [c] = self.plan()['comparisons']
        self.assertEqual((c['kind'], c['old_ref'], c['new_ref'], c['files']),
                         ('changed', f'{TEMURIN}@{A}', f'{TEMURIN}@{B}', ['catalog/Dockerfile.temurin']))

    def test_uncommitted_working_tree_is_the_candidate(self):
        self.write({'example-app/Dockerfile': app(f'{APPROVED}@{B}')})
        [c] = self.plan()['comparisons']
        self.assertEqual(c['new_ref'], f'{APPROVED}@{B}')

    def test_added_repository_is_compared_with_itself(self):
        self.write({'example-app/Dockerfile': app(f'docker.io/acme/tool@{C}', f'{APPROVED}@{A}')})
        [c] = self.plan()['comparisons']
        self.assertEqual((c['kind'], c['old_ref'], c['new_ref']),
                         ('added', f'docker.io/acme/tool@{C}', f'docker.io/acme/tool@{C}'))

    def test_removed_repository_is_reported_only(self):
        self.write({'example-app/Dockerfile': 'FROM scratch\nCOPY a /a\n'})
        result = self.plan()
        self.assertEqual(result['comparisons'], [])
        self.assertEqual(result['removed'], [{'file': 'example-app/Dockerfile', 'ref': f'{APPROVED}@{A}'}])

    def test_same_pair_in_two_files_is_compared_once(self):
        self.write({'base-gate/config.json': json.dumps({'dockerfiles': ['a/Dockerfile', 'b/Dockerfile']}),
                    'a/Dockerfile': app(f'{APPROVED}@{A}'), 'b/Dockerfile': app(f'{APPROVED}@{A}')})
        self.commit()
        base = self.git('rev-parse', 'HEAD')
        self.write({'a/Dockerfile': app(f'{APPROVED}@{B}'), 'b/Dockerfile': app(f'{APPROVED}@{B}')})
        [c] = self.plan(base)['comparisons']
        self.assertEqual(c['files'], ['a/Dockerfile', 'b/Dockerfile'])

    def test_dropping_a_file_from_the_list_does_not_hide_it(self):
        self.write({'base-gate/config.json': json.dumps({'dockerfiles': ['example-app/Dockerfile']}),
                    'catalog/Dockerfile.temurin': catalog(B)})
        [c] = self.plan()['comparisons']
        self.assertEqual(c['new_ref'], f'{TEMURIN}@{B}')

    def test_first_push_is_skipped(self):
        result = self.plan('0' * 40)
        self.assertIn('first push', result['skipped'])
        self.assertEqual(result['comparisons'], [])

    def test_fails_closed(self):
        self.assertIn('not in this clone', self.run_plan('d' * 40).stderr)
        self.assertIn('40-hex', self.run_plan('HEAD').stderr)
        self.write({'example-app/Dockerfile': 'FROM eclipse-temurin:21\n'})
        self.assertIn('not pinned by digest', self.run_plan().stderr)


STUB_CRANE = r'''#!/usr/bin/env bash
for a in "$@"; do [[ "$a" == *@sha256:* ]] && ref="$a"; done
case "$1" in
  digest) echo "${ref##*@}" ;;
  manifest)
    if [[ "$ref" == *"${DRIFT_DIGEST:-none}" ]]; then platforms='"linux/amd64","linux/arm64"'; else platforms='"linux/amd64"'; fi
    python3 -c 'import json,sys; print(json.dumps({"manifests": [{"platform": {"os": p.split("/")[0], "architecture": p.split("/")[1]}} for p in sys.argv[1:]]}))' $(echo "$platforms" | tr -d '"' | tr ',' ' ') ;;
  config) echo '{"config":{"User":"","Env":["PATH=/usr/bin"]}}' ;;
  export)
    if [[ "$ref" == *"${SUID_DIGEST:-none}" ]]; then cat "$STUB_DIR/suid.tar"; else cat "$STUB_DIR/plain.tar"; fi ;;
  *) exit 3 ;;
esac
'''
STUBS = {
    'crane': STUB_CRANE,
    'syft': '#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in syft-json=*) '
            'echo \'{"artifacts":[{"name":"jre","version":"21","type":"deb",'
            '"metadata":{"files":[{"path":"/usr/bin/java"}]}}]}\' > "${a#syft-json=}" ;; esac; done\n',
    'grype': '#!/usr/bin/env bash\necho \'{"matches":[]}\'\n',
    'diffoci': '#!/usr/bin/env bash\necho "differences"\nexit 1\n',
}


def tar_with(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tf:
        for name, mode in entries:
            info = tarfile.TarInfo(name)
            info.mode, info.size = mode, 4
            tf.addfile(info, io.BytesIO(b'data'))
    return buf.getvalue()


class CompareAllTests(unittest.TestCase):
    """compare_all.sh + the kit's real compare.sh/evaluate.py, then decide.py, end to end."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        bindir = self.dir / 'bin'
        bindir.mkdir()
        for name, body in STUBS.items():
            (bindir / name).write_text(body)
            (bindir / name).chmod(0o755)
        (self.dir / 'plain.tar').write_bytes(tar_with([('usr/bin/java', 0o755)]))
        (self.dir / 'suid.tar').write_bytes(tar_with([('usr/bin/java', 0o755), ('usr/bin/sneaky', 0o4755)]))
        self.env = dict(os.environ, PATH=f'{bindir}:{os.environ["PATH"]}', STUB_DIR=str(self.dir))
        self.config = self.dir / 'config.json'
        self.config.write_text(json.dumps({'dockerfiles': [], 'acceptances': []}))

    def tearDown(self):
        self.tmp.cleanup()

    def run_gate(self, comparisons, acceptances=(), **env):
        plan_path = self.dir / 'plan.json'
        plan_path.write_text(json.dumps({'base': 'f' * 40, 'unchanged': [], 'removed': [], 'comparisons': [
            dict(c, id=f'c{i}', files=['x/Dockerfile']) for i, c in enumerate(comparisons, 1)]}))
        self.config.write_text(json.dumps({'dockerfiles': [], 'acceptances': list(acceptances)}))
        reports = self.dir / 'reports'
        compared = subprocess.run(['bash', str(GATE / 'compare_all.sh'), str(plan_path), str(reports)],
                                  cwd=ROOT, env=dict(self.env, **env), capture_output=True, text=True)
        self.assertEqual(compared.returncode, 0, compared.stderr[-2000:])
        return subprocess.run([sys.executable, '-I', str(GATE / 'decide.py'), '--plan', str(plan_path),
                               '--reports', str(reports), '--config', str(self.config)],
                              cwd=ROOT, capture_output=True, text=True)

    def test_routine_update_passes(self):
        result = self.run_gate([{'kind': 'changed', 'old_ref': f'{APPROVED}@{A}', 'new_ref': f'{APPROVED}@{B}'}])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS: changed pin', result.stdout)
        self.assertIn('routine: No verified upstream publisher signature', result.stdout)

    def test_new_suid_file_blocks_and_cannot_be_accepted(self):
        new = f'{APPROVED}@{B}'
        result = self.run_gate([{'kind': 'changed', 'old_ref': f'{APPROVED}@{A}', 'new_ref': new}],
                               acceptances=[{'image': new, 'approved_by': 'me', 'reason': 'r',
                                             'expires': dt.date.today().isoformat()}], SUID_DIGEST=B)
        self.assertEqual(result.returncode, 1)
        self.assertIn("BLOCK: linux/amd64: newly privileged (SUID/SGID) files: ['usr/bin/sneaky']", result.stdout)
        self.assertIn(f'BASE GATE FAILED for {new}', result.stderr)

    def test_added_image_needs_an_acceptance(self):
        ref = f'docker.io/acme/tool@{C}'
        comparison = [{'kind': 'added', 'old_ref': ref, 'new_ref': ref}]
        result = self.run_gate(comparison, SUID_DIGEST=C)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn('ATTENTION: Candidate is the approved baseline itself', result.stdout)
        self.assertIn('absolute review: 1 SUID/SGID files', result.stdout)
        self.assertIn('compared with itself', result.stdout)
        accepted = self.run_gate(comparison, SUID_DIGEST=C, acceptances=[
            {'image': ref, 'approved_by': 'me', 'reason': 'vendor image reviewed',
             'expires': (dt.date.today() + dt.timedelta(days=7)).isoformat()}])
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        self.assertIn('ACCEPTED: added pin', accepted.stdout)

    def test_platform_drift_blocks(self):
        result = self.run_gate([{'kind': 'changed', 'old_ref': f'{APPROVED}@{A}', 'new_ref': f'{APPROVED}@{B}'}],
                               DRIFT_DIGEST=B)
        self.assertEqual(result.returncode, 1)
        self.assertIn('BLOCK: platform set cannot be compared', result.stdout)

    def test_digest_mismatch_stops(self):
        stub = (self.dir / 'bin/crane')
        stub.write_text(STUB_CRANE.replace('digest) echo "${ref##*@}"', f'digest) echo "{C}"'))
        plan_path = self.dir / 'plan.json'
        plan_path.write_text(json.dumps({'comparisons': [{'id': 'c1', 'kind': 'changed', 'files': [],
                                                          'old_ref': f'{APPROVED}@{A}',
                                                          'new_ref': f'{APPROVED}@{B}'}]}))
        result = subprocess.run(['bash', str(GATE / 'compare_all.sh'), str(plan_path), str(self.dir / 'r')],
                                cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('resolves to', result.stderr)

    def test_malformed_plan_is_refused(self):
        plan_path = self.dir / 'plan.json'
        plan_path.write_text(json.dumps({'comparisons': [{'id': 'c1; rm -rf x', 'old_ref': 'a', 'new_ref': 'b'}]}))
        result = subprocess.run(['bash', str(GATE / 'compare_all.sh'), str(plan_path), str(self.dir / 'r')],
                                cwd=ROOT, env=self.env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.dir / 'r' / 'c1').exists())


class DecideTests(unittest.TestCase):
    TODAY = dt.date(2026, 11, 21)
    NEW = f'{APPROVED}@{B}'
    COMPARISON = {'id': 'c1', 'kind': 'changed', 'old_ref': f'{APPROVED}@{A}', 'new_ref': NEW, 'files': ['f']}

    def decision(self, block=(), attention=(), routine=()):
        return {'decision': 'BLOCK' if block else ('REVIEW' if attention or routine else 'AUTO_PASS'),
                'block_reasons': list(block), 'attention_reasons': list(attention),
                'routine_reasons': list(routine)}

    def accept(self, **overrides):
        entry = dict({'image': self.NEW, 'approved_by': 'me', 'reason': 'ok', 'expires': '2026-11-30'}, **overrides)
        return decide.acceptances({'acceptances': [entry]}, self.TODAY)

    def test_verdicts(self):
        accepted = self.accept()
        cases = [
            (self.decision(routine=['r']), {}, 'PASS'),
            (self.decision(), {}, 'PASS'),
            (self.decision(attention=['a']), {}, 'FAIL'),
            (self.decision(attention=['a']), accepted, 'ACCEPTED'),
            (self.decision(block=['b'], attention=['a']), accepted, 'FAIL'),
            (None, accepted, 'FAIL'),
            ({'decision': 'REVIEW'}, accepted, 'FAIL'),
        ]
        for decision, acc, expected in cases:
            with self.subTest(decision=decision, accepted=bool(acc)):
                self.assertEqual(decide.judge(self.COMPARISON, decision, acc)[0], expected)

    def test_acceptance_is_bound_to_the_exact_image(self):
        other = self.accept(image=f'{APPROVED}@{C}')
        self.assertEqual(decide.judge(self.COMPARISON, self.decision(attention=['a']), other)[0], 'FAIL')

    def test_expired_acceptance_is_ignored(self):
        self.assertEqual(self.accept(expires='2026-11-20'), {})
        self.assertIn(self.NEW, self.accept(expires='2026-11-21'))

    def test_invalid_acceptances_are_refused(self):
        for overrides in ({'expires': '2027-03-01'}, {'expires': '30.11.2026'}, {'image': 'eclipse-temurin:21'},
                          {'reason': ' '}, {'extra': 'x'}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.accept(**overrides)
        with self.assertRaises(ValueError):
            decide.acceptances({'acceptances': {}}, self.TODAY)

    def test_summary_escapes_backticks(self):
        text = decide.report({'base': 'f' * 40, 'comparisons': [self.COMPARISON]},
                             [(self.COMPARISON, 'FAIL', 'n', self.decision(attention=['x: ```evil']))])
        self.assertIn("ATTENTION: x: '''evil", text)
        self.assertEqual(text.count('```'), 2)

    def test_repository_config_is_valid(self):
        config = json.loads((GATE / 'config.json').read_text())
        decide.acceptances(config, dt.date.today())
        files = plan.dockerfiles((GATE / 'config.json').read_text(), 'config')
        for rel in files:
            self.assertTrue((ROOT / rel).is_file(), rel)
            self.assertTrue(plan.pins((ROOT / rel).read_text(), rel))


try:
    import yaml
except ImportError:
    yaml = None


@unittest.skipIf(yaml is None, 'PyYAML required')
class WorkflowTests(unittest.TestCase):
    """The gate must sit in the CI workflow the release gate checks, and fail its build."""

    def setUp(self):
        text = (ROOT / '.github/workflows/example-app-ci.yml').read_text()
        self.wf = yaml.load(text, Loader=yaml.BaseLoader)
        self.jobs = self.wf['jobs']
        self.gate = self.jobs['base-image-gate']

    def test_release_gate_checks_this_workflow(self):
        allowlist = json.loads((ROOT / 'release-gate/allowlist.json').read_text())
        checks = allowlist['repositories']['stefanf81/base-image-gatekeeper']['checks']
        self.assertIn('.github/workflows/example-app-ci.yml', checks.values())

    def test_runs_on_every_pull_request_and_push_to_main(self):
        on = self.wf['on']
        self.assertEqual(on['push'], {'branches': ['main']})
        self.assertEqual(on['pull_request'], {'branches': ['main']})

    def test_build_needs_the_gate(self):
        self.assertEqual(self.jobs['test'].get('needs'), 'base-image-gate')
        self.assertNotIn('if', self.jobs['test'])

    def test_gate_is_read_only_and_has_the_history(self):
        self.assertEqual(self.gate['permissions'], {'contents': 'read', 'packages': 'read'})
        checkout = self.gate['steps'][0]
        self.assertEqual(checkout['with']['fetch-depth'], '0')
        self.assertEqual(checkout['with']['persist-credentials'], 'false')

    def test_baseline_is_main(self):
        body = '\n'.join(s.get('run', '') for s in self.gate['steps'])
        self.assertIn('git rev-parse HEAD^1', body)
        self.assertEqual(self.gate['env']['PUSH_BEFORE'], '${{ github.event.before }}')

    def test_decision_runs_even_when_a_comparison_failed(self):
        [decide_step] = [s for s in self.gate['steps'] if 'base-gate/decide.py' in s.get('run', '')]
        self.assertEqual(decide_step['if'], "${{ !cancelled() && steps.plan.outcome == 'success' }}")
        self.assertNotIn('continue-on-error', decide_step)

    def test_release_gate_can_read_the_ci_runs(self):
        gate = yaml.load((ROOT / '.github/workflows/release-gate.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(gate['jobs']['grant']['permissions'], {'contents': 'write', 'actions': 'read'})

if __name__ == '__main__':
    unittest.main()
