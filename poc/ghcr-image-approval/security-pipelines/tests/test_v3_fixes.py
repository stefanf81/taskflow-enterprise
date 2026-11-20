"""Regression tests for the v2 -> v3 review findings (one class per finding, numbered as in CHANGES.md).

These are unit and static tests. They do not replace running the workflows against real
GitHub Actions, GHCR and Kyverno in staging.
"""
import datetime as dt
import gzip
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

try:
    import yaml
except ImportError:
    yaml = None

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / '.github/workflows'
sys.path.insert(0, str(ROOT / 'scripts'))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ident = load('v3_ident', 'ci/image_tar_identity.py')
additive = load('v3_additive', 'ci/check_additive_layers.py')
registry = load('v3_registry', 'ci/check_registry_config.py')
appcfg = load('v3_appcfg', 'ci/app_config.py')
approver = load('v3_approver', 'ci/environment_approver.py')
audit = load('v3_audit', 'ci/audit_repo_settings.py')
source_archive = load('v3_source', 'ci/source_archive.py')
policy_info = load('v3_policy_info', 'scripts/policy_info.py')
vulns = load('v3_vulns', 'scripts/check_application_vulnerabilities.py')
verifier = load('v3_verifier', 'scripts/independent_scan_attestation.py')
from evaluate import critical_exceptions  # noqa: E402

TAG = 'local-application:' + 'c' * 40


# --- synthetic `docker save` archives -----------------------------------------------------------

def layer(entries, compression='gzip'):
    """entries: (name, kind, payload) with kind file|dir|sym. Returns (blob, diff_id)."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w') as tf:
        for name, kind, payload in entries:
            info = tarfile.TarInfo(name)
            if kind == 'dir':
                info.type = tarfile.DIRTYPE
                tf.addfile(info)
            elif kind == 'sym':
                info.type, info.linkname = tarfile.SYMTYPE, payload
                tf.addfile(info)
            else:
                data = payload if isinstance(payload, bytes) else payload.encode()
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))
    data = raw.getvalue()
    diff_id = 'sha256:' + hashlib.sha256(data).hexdigest()
    if compression == 'gzip':
        blob = gzip.compress(data, mtime=0)
    elif compression == 'zstd':
        blob = b'\x28\xb5\x2f\xfd' + data
    else:
        blob = data
    return blob, diff_id


def archive(path, layers, repotags=(TAG,), oci=True, diff_ids=None, config_extra=None, tamper_config=False,
            oci_config=None):
    config = {'architecture': 'amd64', 'os': 'linux',
              'rootfs': {'type': 'layers', 'diff_ids': diff_ids or [d for _, d in layers]}}
    config.update(config_extra or {})
    config_bytes = json.dumps(config, sort_keys=True).encode()
    config_hex = hashlib.sha256(config_bytes).hexdigest()
    members = {}
    layer_names = []
    for blob, _ in layers:
        h = hashlib.sha256(blob).hexdigest()
        members[f'blobs/sha256/{h}'] = blob
        layer_names.append(f'blobs/sha256/{h}')
    members[f'blobs/sha256/{config_hex}'] = config_bytes + (b' ' if tamper_config else b'')
    members['manifest.json'] = json.dumps([{'Config': f'blobs/sha256/{config_hex}', 'RepoTags': list(repotags),
                                            'Layers': layer_names}]).encode()
    if oci:
        manifest = json.dumps({'schemaVersion': 2, 'config': {'digest': oci_config or 'sha256:' + config_hex},
                               'layers': [{'digest': n.replace('blobs/sha256/', 'sha256:')} for n in layer_names]}).encode()
        mhex = hashlib.sha256(manifest).hexdigest()
        members[f'blobs/sha256/{mhex}'] = manifest
        members['index.json'] = json.dumps({'schemaVersion': 2, 'manifests': [{'digest': 'sha256:' + mhex}]}).encode()
    with tarfile.open(path, 'w') as tf:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return 'sha256:' + config_hex


BASE = [('usr/', 'dir', None), ('usr/lib/', 'dir', None), ('usr/lib/libssl.so.3', 'file', 'ssl'),
        ('lib', 'sym', 'usr/lib'), ('etc/', 'dir', None), ('etc/os-release', 'file', 'NAME=x'),
        ('var/lib/dpkg/status', 'file', 'Package: openssl')]


class Finding1ConfigDigestIdentityTests(unittest.TestCase):
    """v2 compared `docker image inspect .Id` (= OCI MANIFEST digest on the containerd store)
    with the registry manifest's config.digest: every release failed at promote."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.base = layer(BASE)
        self.app = layer([('app/', 'dir', None), ('app/app.jar', 'file', 'jar')])

    def tearDown(self):
        self.tmp.cleanup()

    def test_identity_is_config_digest_and_matches_registry_manifest(self):
        tar = self.dir / 'img.tar'
        config = archive(tar, [self.base, self.app])
        result = ident.identity(tar, TAG)
        self.assertEqual(result['config_digest'], config)
        self.assertNotEqual(result['manifest_digest'], config)  # what v2 attested as "image ID"
        self.assertEqual(result['platform'], 'linux/amd64')
        # Registry manifest written by crane (Docker media types, different manifest digest):
        (self.dir / 'm.json').write_text(json.dumps({'schemaVersion': 2, 'config': {'digest': config},
                                                     'layers': [{'digest': 'sha256:' + 'e' * 64}]}))
        (self.dir / 'id').write_text(config + '\n')
        self.assertEqual(registry.verify(self.dir / 'm.json', self.dir / 'id', self.dir / 'id'), config)
        # The v2 input (manifest digest) is rejected by the same check:
        (self.dir / 'id').write_text(result['manifest_digest'])
        with self.assertRaisesRegex(ValueError, 'registry config digest'):
            registry.verify(self.dir / 'm.json', self.dir / 'id', self.dir / 'id')

    def test_crane_pull_and_classic_names_accepted(self):
        tar = self.dir / 'img.tar'
        archive(tar, [self.base], oci=False)
        with tarfile.open(tar) as tf:
            manifest = json.loads(tf.extractfile('manifest.json').read())
        self.assertTrue(manifest[0]['Config'].startswith('blobs/sha256/'))
        self.assertIsNone(ident.identity(tar)['manifest_digest'])

    def test_tampered_config_rejected(self):
        tar = self.dir / 'img.tar'
        archive(tar, [self.base], tamper_config=True)
        with self.assertRaisesRegex(ValueError, 'content-addressed name'):
            ident.identity(tar)

    def test_oci_index_naming_another_config_rejected(self):
        tar = self.dir / 'img.tar'
        archive(tar, [self.base], oci_config='sha256:' + 'f' * 64)
        with self.assertRaisesRegex(ValueError, 'different configs'):
            ident.identity(tar)

    def test_layer_count_must_match_diff_ids(self):
        tar = self.dir / 'img.tar'
        archive(tar, [self.base], diff_ids=[self.base[1], self.app[1]])
        with self.assertRaisesRegex(ValueError, 'Layers do not match'):
            ident.identity(tar)

    def test_pipeline_and_workflow_use_config_digest(self):
        src = (ROOT / 'ci/application_pipeline.sh').read_text()
        wf = (WF / 'application-release.yml').read_text()
        self.assertIn('image_tar_identity.py application-image.tar --expected-repotag', src)
        self.assertIn('image-identity-a/config-digest.txt image-identity-b/config-digest.txt', src)
        self.assertNotIn('image-identity-a/image-id.txt', src + wf)
        self.assertIn('require_gh_attestation.sh image-identity-a/config-digest.txt', wf)


class Finding2ShaPinnedActionsTests(unittest.TestCase):
    USES = re.compile(r'^\s*-?\s*uses:\s*(\S+)(.*)$')

    def all_uses(self):
        for path in list(WF.glob('*.yml')) + list((ROOT / 'examples').rglob('*.yml')):
            for line in path.read_text().splitlines():
                m = self.USES.match(line)
                if m:
                    yield path.name, m.group(1), m.group(2)

    def test_every_action_is_pinned_to_a_commit_sha_with_version_comment(self):
        uses = list(self.all_uses())
        self.assertGreater(len(uses), 20)
        for name, ref, rest in uses:
            with self.subTest(file=name, uses=ref):
                self.assertRegex(ref, r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}$')
                self.assertRegex(rest, r'^\s+# v\d+\.\d+\.\d+$')

    def test_same_action_uses_one_pin_everywhere(self):
        pins = {}
        for _, ref, rest in self.all_uses():
            action, sha = ref.split('@')
            pins.setdefault(action, set()).add((sha, rest.strip()))
        for action, values in pins.items():
            self.assertEqual(len(values), 1, f'{action} pinned to several versions: {values}')

    def test_docker_engine_version_is_pinned_for_reproducible_builds(self):
        text = (WF / 'application-release.yml').read_text()
        self.assertRegex(text, r'version: v\d+\.\d+\.\d+')


@unittest.skipIf(yaml is None, 'PyYAML required')
class Finding3ParsersHaveNoWriteTokenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = yaml.safe_load((WF / 'application-release.yml').read_text())['jobs']
        cls.base = yaml.safe_load((WF / 'base-image-approval.yml').read_text())['jobs']

    def steps_text(self, job):
        return json.dumps(job.get('steps', []))

    def test_application_scan_is_read_only_and_push_is_separate(self):
        self.assertEqual(self.app['scan']['permissions']['packages'], 'read')
        self.assertNotIn('setup-docker-action', self.steps_text(self.app['scan']))
        self.assertIn('application_pipeline.sh scan', self.steps_text(self.app['scan']))
        push = self.app['push_candidate']
        self.assertEqual(push['permissions']['packages'], 'write')
        self.assertEqual(push['environment'], 'ghcr-candidate-writer')
        self.assertEqual(push['needs'], 'scan')
        text = self.steps_text(push)
        for parser in ('syft', 'grype', 'docker load', 'setup-docker-action'):
            self.assertNotIn(parser, text)

    def test_push_function_runs_no_scanner(self):
        src = (ROOT / 'ci/application_pipeline.sh').read_text()
        push = src[src.index('push_candidate() {'):src.index('promote_image() {')]
        for parser in ('syft', 'grype', 'docker ', 'check_additive_layers'):
            self.assertNotIn(parser, push)

    def test_base_evaluate_is_read_only_and_quarantine_copy_is_separate(self):
        self.assertEqual(self.base['evaluate']['permissions']['packages'], 'read')
        self.assertNotIn('skopeo', self.steps_text(self.base['evaluate']))
        self.assertNotIn('skopeo', (ROOT / 'ci/base_evaluate.sh').read_text())
        q = self.base['quarantine']
        self.assertEqual(q['permissions']['packages'], 'write')
        self.assertEqual(q['environment'], 'ghcr-quarantine')
        quarantine = (ROOT / 'ci/base_quarantine.sh').read_text()
        for parser in ('compare.sh', 'grype', 'syft', 'diffoci', 'evaluate.py'):
            self.assertNotIn(parser, quarantine)

    def test_only_expected_jobs_can_write_packages(self):
        writers = {n for n, j in self.app.items() if (j.get('permissions') or {}).get('packages') == 'write'}
        self.assertEqual(writers, {'push_candidate', 'promote', 'sign'})
        writers = {n for n, j in self.base.items() if (j.get('permissions') or {}).get('packages') == 'write'}
        self.assertEqual(writers, {'quarantine', 'promote'})


class Finding4OriginProvenBaseExceptionTests(unittest.TestCase):
    BASE_REF = 'ghcr.io/acme/approved/eclipse-temurin@sha256:' + 'b' * 64
    IMAGE = 'ghcr.io/acme/applications/app@sha256:' + 'd' * 64

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.base = layer(BASE)
        self.base_config = {'rootfs': {'diff_ids': [self.base[1]]}}

    def tearDown(self):
        self.tmp.cleanup()

    def analyse(self, app_entries, compression='gzip'):
        tar = self.dir / 'img.tar'
        archive(tar, [self.base, layer(app_entries, compression)])
        return additive.analyse(tar, self.base_config)

    # -- layer analysis --
    def test_additive_application(self):
        report = self.analyse([('usr/', 'dir', None), ('usr/lib/', 'dir', None), ('usr/lib/new.so', 'file', 'x'),
                               ('app/app.jar', 'file', 'jar')])
        self.assertTrue(report['additive'], report['violations'])
        self.assertEqual(report['base_diff_ids'], [self.base[1]])

    def test_overwritten_base_file_is_not_additive(self):
        report = self.analyse([('usr/lib/libssl.so.3', 'file', 'patched')])
        self.assertFalse(report['additive'])
        self.assertIn('usr/lib/libssl.so.3: base file replaced by file', report['violations'])

    def test_whiteouts_are_not_additive(self):
        self.assertFalse(self.analyse([('usr/lib/.wh.libssl.so.3', 'file', '')])['additive'])
        self.assertFalse(self.analyse([('usr/lib/.wh..wh..opq', 'file', '')])['additive'])

    def test_write_through_base_symlink_is_not_additive(self):
        report = self.analyse([('lib/libssl.so.3', 'file', 'evil')])
        self.assertFalse(report['additive'])
        self.assertTrue(any('through symlink lib' in v for v in report['violations']))

    def test_base_file_replaced_by_symlink_is_not_additive(self):
        self.assertFalse(self.analyse([('etc/os-release', 'sym', '/tmp/x')])['additive'])

    def test_unsupported_compression_fails_closed_to_not_additive(self):
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            self.analyse([('app/app.jar', 'file', 'jar')], compression='zstd')

    def test_layer_bytes_must_match_diff_id(self):
        tar = self.dir / 'img.tar'
        app = layer([('app/app.jar', 'file', 'jar')])
        archive(tar, [self.base, (app[0], app[1])], diff_ids=[self.base[1], 'sha256:' + '0' * 64])
        with self.assertRaisesRegex(ValueError, 'does not match diff_id'):
            additive.analyse(tar, self.base_config)

    def test_image_must_extend_base_exactly(self):
        tar = self.dir / 'img.tar'
        archive(tar, [layer([('x', 'file', 'y')]), layer([('app', 'file', 'z')])])
        with self.assertRaisesRegex(ValueError, 'do not extend'):
            additive.analyse(tar, self.base_config)

    # -- vulnerability decision --
    def grype(self, layer_id):
        return {'matches': [{'vulnerability': {'id': 'CVE-2026-1', 'severity': 'Critical'},
                             'artifact': {'name': 'openssl', 'version': '3.0',
                                          'locations': [{'path': '/var/lib/dpkg/status', 'layerID': layer_id}]}}],
                'source': {'target': {'userInput': 'registry:' + self.IMAGE}}}

    def exceptions(self):
        entry = {'id': 'CVE-2026-1', 'package': 'openssl', 'package_version': '3.0', 'platform': 'linux/amd64',
                 'expires': '2099-01-01', 'reason': 'no fix upstream', 'approved_by': 'sec-team',
                 'base_image_ref': self.BASE_REF}
        return critical_exceptions({'critical_exceptions': [entry]}, dt.date(2026, 11, 18))

    def decide(self, layer_id, unmodified):
        return vulns.decision(self.grype(layer_id), self.exceptions(), self.IMAGE, 'linux/amd64', self.BASE_REF,
                              {self.base[1]}, self.IMAGE, None, unmodified)

    def test_base_exception_applies_only_with_both_proofs(self):
        ok = self.decide(self.base[1], True)
        self.assertEqual(ok['decision'], 'PASS')
        self.assertEqual(ok['critical_excepted'][0]['scope'], 'base_image_ref')
        self.assertEqual(self.decide(self.base[1], False)['decision'], 'BLOCK')      # files may be modified
        self.assertEqual(self.decide('sha256:' + '9' * 64, True)['decision'], 'BLOCK')  # found in app layer

    def write_overlay(self, **changes):
        report = {'schema': vulns.OVERLAY_SCHEMA, 'config_digest': 'sha256:' + '1' * 64,
                  'base_diff_ids': [self.base[1]], 'application_layer_count': 1, 'additive': True, 'violations': []}
        report.update(changes)
        path = self.dir / 'overlay.json'
        path.write_text(json.dumps(report))
        return path

    def test_overlay_report_must_match_base_and_image(self):
        self.assertTrue(vulns.load_layer_overlay(self.write_overlay(), {self.base[1]}, 'sha256:' + '1' * 64))
        with self.assertRaisesRegex(ValueError, 'different base'):
            vulns.load_layer_overlay(self.write_overlay(base_diff_ids=['sha256:' + '2' * 64]), {self.base[1]})
        with self.assertRaisesRegex(ValueError, 'different image config'):
            vulns.load_layer_overlay(self.write_overlay(), {self.base[1]}, 'sha256:' + '3' * 64)
        with self.assertRaisesRegex(ValueError, 'schema'):
            vulns.load_layer_overlay(self.write_overlay(schema='x'), {self.base[1]})

    def test_independent_verifier_binds_overlay_report(self):
        (self.dir / 'scan.json').write_text(json.dumps(self.grype(self.base[1])))
        (self.dir / 'policy.json').write_text(json.dumps({'version': 'v3', 'critical_exceptions': [
            {'id': 'CVE-2026-1', 'package': 'openssl', 'package_version': '3.0', 'platform': 'linux/amd64',
             'expires': '2099-01-01', 'reason': 'r', 'approved_by': 'a', 'base_image_ref': self.BASE_REF}]}))
        (self.dir / 'base.json').write_text(json.dumps(self.base_config))
        overlay = self.write_overlay()
        args = (self.IMAGE, 'linux/amd64', self.dir / 'scan.json', self.dir / 'policy.json', self.BASE_REF, 'a' * 40)
        record = verifier.create(*args, base_config=self.dir / 'base.json', layer_overlay=overlay)
        self.assertTrue(record['baseFilesUnmodified'])
        vargs = (record, self.IMAGE, 'linux/amd64', 'a' * 40, self.dir / 'policy.json', self.dir / 'scan.json')
        self.assertTrue(verifier.validate(*vargs, base_config=self.dir / 'base.json', layer_overlay=overlay))
        with self.assertRaisesRegex(ValueError, 'layer overlay report differs'):
            verifier.validate(*vargs, base_config=self.dir / 'base.json', layer_overlay=None)
        self.write_overlay(additive=False)
        with self.assertRaisesRegex(ValueError, 'layer overlay report differs'):
            verifier.validate(*vargs, base_config=self.dir / 'base.json', layer_overlay=overlay)
        with self.assertRaisesRegex(ValueError, 'refuses image: BLOCK'):
            verifier.create(*args, base_config=self.dir / 'base.json', layer_overlay=overlay)

    def test_pipeline_passes_overlay_everywhere(self):
        src = (ROOT / 'ci/application_pipeline.sh').read_text()
        self.assertIn('--layer-overlay publish-evidence/layer-overlay.json --image-config-digest', src)
        self.assertEqual(src.count('--layer-overlay publish-evidence/independent-layer-overlay.json'), 2)
        self.assertNotIn('origin_base = None', (ROOT / 'scripts/check_application_vulnerabilities.py').read_text())


class Finding5ApplicationAllowlistTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.tmp.name) / 'apps.json'

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, apps):
        self.path.write_text(json.dumps({'schema': appcfg.SCHEMA, 'applications': apps}))
        return self.path

    def test_shipped_allowlist_resolves(self):
        result = appcfg.resolve(ROOT / 'policy/applications.json', 'example-app')
        self.assertEqual(result['source_repo'], 'stefanf81/ghcr-approval-poc-app')

    def test_rejections(self):
        good = {'source_repo': 'acme/one', 'dockerfile': 'Dockerfile', 'build_outputs': 'target/one.jar'}
        cases = [('missing', {'one': good}), ('../one', {'one': good}),
                 ('one', {'one': dict(good, source_repo='acme/one/../x')}),
                 ('one', {'one': dict(good, dockerfile='../Dockerfile')}),
                 ('one', {'one': dict(good, build_outputs='target/*.jar')}),
                 ('one', {'one': dict(good, extra='x')}),
                 ('one', {'One': good, 'one': good})]
        for name, apps in cases:
            with self.subTest(name=name, apps=apps):
                with self.assertRaises(ValueError):
                    appcfg.resolve(self.write(apps), name)
        self.assertEqual(appcfg.resolve(self.write({'one': good}), 'one')['dockerfile'], 'Dockerfile')

    def test_workflow_takes_app_name_and_reads_nothing_else_from_variables(self):
        text = (WF / 'application-release.yml').read_text()
        self.assertIn('app_name:', text)
        self.assertIn('group: ghcr-app-${{ inputs.app_name }}', text)
        for var in ('vars.APP_SOURCE_REPO', 'vars.APP_NAME', 'vars.APP_DOCKERFILE', 'vars.APP_BUILD_OUTPUTS'):
            self.assertNotIn(var, text)
        self.assertIn('ci/app_config.py --name "$APP_NAME" --field source_repo',
                      (ROOT / 'ci/application_pipeline.sh').read_text())


class Finding6AlreadyApprovedShortcutTests(unittest.TestCase):
    DIGEST = 'sha256:' + 'a' * 64

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        repo = self.dir / 'repo'
        for d in ('ci', 'scripts', 'policy'):
            shutil.copytree(ROOT / d, repo / d)
        (repo / 'catalog').mkdir()
        (repo / 'catalog/Dockerfile.temurin').write_text(f'FROM eclipse-temurin:21-jre-resolute@{self.DIGEST}\n')
        (repo / 'scripts/check_approval_attestation.py').write_text(
            'import os,sys\nsys.exit(int(os.environ["FAKE_ATTEST_RC"]))\n')
        bin_ = self.dir / 'bin'
        bin_.mkdir()
        (bin_ / 'crane').write_text('#!/bin/sh\necho "$FAKE_APPROVED_DIGEST"\n')
        (bin_ / 'cosign').write_text('#!/bin/sh\necho "{}"\nexit "$FAKE_COSIGN_RC"\n')
        for f in bin_.iterdir():
            f.chmod(0o755)
        self.repo, self.bin = repo, bin_

    def tearDown(self):
        self.tmp.cleanup()

    def precheck(self, approved, cosign_rc=0, attest_rc=0):
        env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', GHCR_HOST='ghcr.io', GHCR_NAMESPACE='acme',
                   GHCR_APPROVED_REPO='ghcr.io/acme/approved/eclipse-temurin',
                   GHCR_QUARANTINE_REPO='ghcr.io/acme/quarantine/eclipse-temurin', APPROVAL_PUBKEY='k.pub',
                   APPROVAL_PREDICATE_TYPE='https://example.org/ghcr-base-approval/v1',
                   FAKE_APPROVED_DIGEST=approved, FAKE_COSIGN_RC=str(cosign_rc), FAKE_ATTEST_RC=str(attest_rc))
        result = subprocess.run(['bash', 'ci/base_precheck.sh'], cwd=self.repo, env=env, capture_output=True,
                                text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_already_approved_digest_is_skipped(self):
        self.assertEqual(self.precheck(self.DIGEST), 'approved')

    def test_new_digest_or_invalid_approval_is_evaluated(self):
        self.assertEqual(self.precheck('sha256:' + 'b' * 64), 'needed')
        self.assertEqual(self.precheck(self.DIGEST, cosign_rc=1), 'needed')
        self.assertEqual(self.precheck(self.DIGEST, attest_rc=1), 'needed')

    @unittest.skipIf(yaml is None, 'PyYAML required')
    def test_workflow_skips_quarantine_evaluate_and_promote(self):
        jobs = yaml.safe_load((WF / 'base-image-approval.yml').read_text())['jobs']
        self.assertEqual(jobs['precheck']['permissions']['packages'], 'read')
        self.assertIn("needs.precheck.outputs.status == 'needed'", jobs['quarantine']['if'])
        self.assertEqual(jobs['evaluate']['needs'], 'quarantine')
        self.assertEqual(jobs['promote']['needs'], 'evaluate')


class Finding7EnvironmentApproverTests(unittest.TestCase):
    def approvals(self, *items):
        return [{'state': state, 'user': {'login': login}, 'environments': [{'name': env}]}
                for state, login, env in items]

    def test_picks_reviewer_of_named_environment_only(self):
        data = self.approvals(('approved', 'alice', 'application-high-cve-review'),
                              ('approved', 'bob', 'ghcr-application-signing'))
        self.assertEqual(approver.approver(data, 'application-high-cve-review', 'dispatcher'), 'alice')

    def test_rejections(self):
        env = 'application-high-cve-review'
        cases = [self.approvals(('approved', 'bob', 'ghcr-application-signing')),
                 self.approvals(('rejected', 'alice', env)),
                 self.approvals(('approved', 'alice', env), ('approved', 'carol', env)),
                 self.approvals(('approved', 'Dispatcher', env)),
                 {'not': 'a list'}]
        for data in cases:
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    approver.approver(data, env, 'dispatcher')

    def test_both_workflows_use_the_filter(self):
        for name, env in (('application-release.yml', 'application-high-cve-review'),
                          ('base-image-approval.yml', 'base-manual-approval')):
            text = (WF / name).read_text()
            self.assertIn(f'ci/environment_approver.py --environment {env}', text)
            self.assertIn('--triggering-actor "$GITHUB_TRIGGERING_ACTOR"', text)
            self.assertNotIn('| last // empty', text)


class Finding8AttestedBaseListsTests(unittest.TestCase):
    def test_builders_attest_base_lists_and_scan_verifies_them(self):
        wf = (WF / 'application-release.yml').read_text()
        attest = wf[wf.index('subject-path: |'):wf.index('name: image-identity-')]
        for f in ('application-image.tar', 'image-evidence/config-digest.txt',
                  'image-evidence/base-images.txt', 'image-evidence/final-base.txt'):
            self.assertIn(f, attest)
        src = (ROOT / 'ci/application_pipeline.sh').read_text()
        self.assertIn('ATTESTED_EVIDENCE=(image-evidence/config-digest.txt image-evidence/base-images.txt '
                      'image-evidence/final-base.txt)', src)
        self.assertIn('for file in "${ATTESTED_EVIDENCE[@]}"; do verify_attested', src)
        self.assertIn('cmp "image-a/$file" "image-b/$file"', src)


class Finding9RepoTagsGuardTests(unittest.TestCase):
    def test_archive_must_carry_exactly_the_expected_tag(self):
        with tempfile.TemporaryDirectory() as tmp:
            tar = pathlib.Path(tmp) / 'img.tar'
            base = layer(BASE)
            archive(tar, [base], repotags=(TAG, 'ghcr.io/acme/approved/eclipse-temurin:21'))
            with self.assertRaisesRegex(ValueError, 'RepoTags'):
                ident.identity(tar, TAG)
            archive(tar, [base], repotags=('other:tag',))
            with self.assertRaisesRegex(ValueError, 'RepoTags'):
                ident.identity(tar, TAG)

    def test_no_docker_load_of_builder_archives(self):
        self.assertNotIn('docker load', (ROOT / 'ci/application_pipeline.sh').read_text())


class Finding10PushDigestTests(unittest.TestCase):
    def test_digest_comes_from_push_not_tag_lookup(self):
        src = (ROOT / 'ci/application_pipeline.sh').read_text()
        self.assertIn('crane push "$tar" "$APP_CANDIDATE_REPO:$APP_TAG" --image-refs', src)
        self.assertIn('crane digest --tarball', src)
        self.assertNotIn('crane digest "$APP_CANDIDATE_REPO:$APP_TAG"', src)


class Finding11VerificationFreshnessTests(unittest.TestCase):
    def test_policy_controls_freshness(self):
        config = json.loads((ROOT / 'policy/config.json').read_text())
        self.assertEqual(policy_info.info(config)['verification_max_age_minutes'], '30')
        for bad in (0, 1441, '30', True):
            with self.assertRaises(ValueError):
                policy_info.info(dict(config, verification_max_age_minutes=bad))
        src = (ROOT / 'ci/application_pipeline.sh').read_text()
        self.assertIn('policy_info.py --field verification_max_age_minutes', src)
        self.assertNotIn('--max-age-minutes 10', src)


class Finding12SingleTokenHolderTests(unittest.TestCase):
    @unittest.skipIf(yaml is None, 'PyYAML required')
    def test_read_token_only_in_authorize(self):
        jobs = yaml.safe_load((WF / 'application-release.yml').read_text())['jobs']
        holders = [name for name, job in jobs.items() if 'APPLICATION_READ_TOKEN' in json.dumps(job)]
        self.assertEqual(holders, ['authorize'])

    @unittest.skipIf(yaml is None, 'PyYAML required')
    def test_compile_has_no_environment(self):
        jobs = yaml.safe_load((WF / 'application-release.yml').read_text())['jobs']
        self.assertNotIn('environment', jobs['compile'])
        self.assertEqual(jobs['image_build']['environment'], 'ghcr-read-only')

    @unittest.skipUnless(shutil.which('git'), 'git required')
    def test_source_archive_round_trip_and_rejections(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            repo = tmp / 'app'
            (repo / 'ci').mkdir(parents=True)
            (repo / 'ci/build_and_test.sh').write_text('#!/bin/sh\n')
            (repo / 'ci/build_and_test.sh').chmod(0o755)
            env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@e', GIT_COMMITTER_NAME='t',
                       GIT_COMMITTER_EMAIL='t@e', GIT_COMMITTER_DATE='2026-11-18T12:00:00+00:00')
            for cmd in (['init', '-q'], ['add', '.'], ['commit', '-qm', 'x']):
                subprocess.run(['git', '-C', str(repo), *cmd], check=True, env=env)
            commit = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], capture_output=True,
                                    text=True, check=True).stdout.strip()
            info = source_archive.create(repo, commit, tmp / 'src.tar')
            self.assertEqual(info['commit_epoch'], str(int(dt.datetime(2026, 11, 18, 12, tzinfo=dt.timezone.utc).timestamp())))
            source_archive.extract(tmp / 'src.tar', info['sha256'], tmp / 'out')
            self.assertTrue(os.access(tmp / 'out/ci/build_and_test.sh', os.X_OK))
            self.assertFalse((tmp / 'out/.git').exists())
            with self.assertRaisesRegex(ValueError, 'must be empty'):
                source_archive.extract(tmp / 'src.tar', info['sha256'], tmp / 'out')
            with self.assertRaisesRegex(ValueError, 'does not match'):
                source_archive.extract(tmp / 'src.tar', '0' * 64, tmp / 'out2')
            with self.assertRaisesRegex(ValueError, 'not the authorized commit'):
                source_archive.create(repo, 'f' * 40, tmp / 'src2.tar')
            evil = tmp / 'evil.tar'
            with tarfile.open(evil, 'w') as tf:
                link = tarfile.TarInfo('escape')
                link.type, link.linkname = tarfile.SYMTYPE, '../../outside'
                tf.addfile(link)
            digest = hashlib.sha256(evil.read_bytes()).hexdigest()
            with self.assertRaises(tarfile.TarError):
                source_archive.extract(evil, digest, tmp / 'out3')


class Finding13RepositorySettingsAuditTests(unittest.TestCase):
    def good(self):
        envs = {}
        for name in audit.ENVIRONMENTS:
            env = {'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True},
                   'protection_rules': []}
            if name in audit.REVIEWER_ENVIRONMENTS:
                env['protection_rules'] = [{'type': 'required_reviewers', 'prevent_self_review': True,
                                            'reviewers': [{'type': 'Team'}]}]
            envs[name] = env
        rules = [{'name': f'restrict {t} creation', 'target': t, 'enforcement': 'active',
                  'conditions': {'ref_name': {'include': ['~ALL'], 'exclude': []}},
                  'bypass_actors': [{'actor_id': 5, 'actor_type': 'RepositoryRole', 'bypass_mode': 'always'}],
                  'rules': [{'type': 'creation'}, {'type': 'update'}]} for t in ('branch', 'tag')]
        return {'workflow_permissions': {'default_workflow_permissions': 'read',
                                         'can_approve_pull_request_reviews': False},
                'environments': envs,
                'branch_policies': {n: [{'name': 'main', 'type': 'branch'}] for n in audit.ENVIRONMENTS},
                'rulesets': rules,
                'main_branch_protection': {'required_pull_request_reviews': {'required_approving_review_count': 2, 'dismiss_stale_reviews': True},
                                           'required_status_checks': {'checks': [{'context': 'security-pr / unit-tests'}]},
                                           'enforce_admins': {'enabled': True},
                                           'allow_force_pushes': {'enabled': False}, 'allow_deletions': {'enabled': False}}}

    def test_good_settings_pass(self):
        self.assertEqual(audit.audit(self.good()), [])

    def test_each_weakness_is_reported(self):
        def mutate(fn):
            s = self.good()
            fn(s)
            return audit.audit(s)
        checks = {
            'read-only': lambda s: s['workflow_permissions'].update(default_workflow_permissions='write'),
            'approve pull requests': lambda s: s['workflow_permissions'].update(can_approve_pull_request_reviews=True),
            'does not exist': lambda s: s['environments'].update({'ghcr-quarantine': None}),
            'every branch': lambda s: s['environments']['ghcr-application-signing'].update(deployment_branch_policy=None),
            'exactly the main': lambda s: s['branch_policies'].update({'ghcr-read-only': [{'name': '*', 'type': 'branch'}]}),
            'Prevent self-review': lambda s: s['environments']['application-high-cve-review']['protection_rules'][0].update(prevent_self_review=False),
            'creating branches': lambda s: s['rulesets'][0].update(enforcement='evaluate'),
            'creating tags': lambda s: s['rulesets'][1]['conditions']['ref_name'].update(exclude=['refs/tags/v*']),
        }
        for fragment, fn in checks.items():
            with self.subTest(fragment=fragment):
                self.assertTrue(any(fragment in f for f in mutate(fn)), mutate(fn))

    @unittest.skipIf(yaml is None, 'PyYAML required')
    def test_audited_environments_are_exactly_the_workflow_environments(self):
        names = set()
        for path in WF.glob('*.yml'):
            for job in (yaml.safe_load(path.read_text())['jobs'] or {}).values():
                env = job.get('environment')
                if isinstance(env, str):
                    names.update(re.findall(r"'([a-z0-9-]+)'", env) if '${{' in env else [env])
        self.assertEqual(names, set(audit.ENVIRONMENTS))


class DocumentationTests(unittest.TestCase):
    def test_every_workflow_secret_and_variable_is_documented(self):
        setup = (ROOT / 'docs/SETUP.md').read_text()
        names = set()
        for path in WF.glob('*.yml'):
            names.update(re.findall(r'\$\{\{\s*(?:secrets|vars)\.([A-Z0-9_]+)', path.read_text()))
        self.assertGreater(len(names), 10)
        for name in sorted(names):
            self.assertIn(f'`{name}`', setup, name)
        for retired in ('`APP_SOURCE_REPO`', '`APP_BUILD_OUTPUTS`', '`APP_DOCKERFILE`', '`APP_NAME`'):
            self.assertNotIn(retired, setup)

    def test_changes_file_covers_every_finding(self):
        changes = (ROOT / 'CHANGES.md').read_text()
        for n in range(1, 14):
            self.assertRegex(changes, rf'(?m)^{n}\. ')


if __name__ == '__main__':
    unittest.main()
