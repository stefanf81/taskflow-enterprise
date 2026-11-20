"""GHCR-specific regression tests. These do not replace live GHCR/Actions/Kyverno tests."""
from pathlib import Path
import json
import os
import re
import subprocess
import unittest
try:
    import yaml
except ImportError:
    yaml = None

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / '.github/workflows'


@unittest.skipIf(yaml is None, 'PyYAML required')
class GHCRWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = yaml.safe_load((WORKFLOWS / 'base-image-approval.yml').read_text())
        cls.app = yaml.safe_load((WORKFLOWS / 'application-release.yml').read_text())

    def test_base_permissions_are_explicit(self):
        expected = dict(precheck='read', quarantine='write', evaluate='read', promote='write')
        for job, permission in expected.items():
            self.assertEqual(self.base['jobs'][job]['permissions']['packages'], permission)
        self.assertIn('GHCR_NAMESPACE', (WORKFLOWS/'base-image-approval.yml').read_text())
        self.assertEqual(self.base['jobs']['quarantine']['environment'], 'ghcr-quarantine')

    def test_application_permissions_by_job(self):
        required = dict(image_build='read', scan='read', push_candidate='write', promote='write',
                        independent_rescan='read', sign='write')
        for job, permission in required.items():
            with self.subTest(job=job):
                self.assertEqual(self.app['jobs'][job]['permissions']['packages'], permission)
        for job in ('authorize', 'compile', 'independent_verification'):
            self.assertNotEqual(self.app['jobs'][job].get('permissions', {}).get('packages'), 'write')

    def test_no_legacy_harbor_robots_or_registry_hostname(self):
        for workflow in WORKFLOWS.glob('*.yml'):
            text = workflow.read_text()
            self.assertNotIn('HARBOR_', text)
            self.assertNotIn('harbor.example.internal', text)
            self.assertNotIn('secrets.GHCR_', text)
        self.assertIn('ghcr.io/${{ vars.GHCR_NAMESPACE }}/approved/',
                      (WORKFLOWS/'application-release.yml').read_text())

    def test_policy_migration_never_accepts_old_harbor_versions(self):
        p = json.loads((ROOT/'policy/config.json').read_text())
        # v6: old signatures are only eligible as historical comparison baselines.
        self.assertEqual(p['version'], '2026-11-ghcr-v6')
        self.assertEqual(p['accepted_approval_policy_versions'], ['2026-11-ghcr-v6'])
        self.assertEqual(p['historical_baseline_policy_versions'],
                         ['2026-11-ghcr-v6', '2026-11-ghcr-v5', '2026-11-ghcr-v4'])
        self.assertTrue(all(v.startswith('2026-11-ghcr-') for v in p['historical_baseline_policy_versions']))

    def test_kyverno_names_and_registry_guards(self):
        for p in list((ROOT/'examples').glob('kyverno-*.yaml')) + list((ROOT/'examples/audit').glob('kyverno-*.yaml')):
            text = p.read_text()
            doc = yaml.safe_load(text)
            self.assertRegex(doc['metadata']['name'], r'^[a-z0-9]([-a-z0-9]*[a-z0-9])?$')
            self.assertNotIn('GHCR[.]example[.]internal', text)
            self.assertNotIn('harbor.example.internal', text)
            self.assertTrue('ghcr.io/example-org' in text or 'ghcr[.]io/example-org' in text)

    def test_renovate_uses_ghcr_lowercase(self):
        cfg = json.loads((ROOT/'examples/renovate-application.json').read_text())
        self.assertEqual(cfg['packageRules'][0]['matchPackageNames'],
                         [r'/^ghcr\.io\/example-org\/approved\//'])


class GHCRReferenceValidationTests(unittest.TestCase):
    SCRIPT = ROOT/'ci/require_ghcr_config.sh'
    BASE = dict(GHCR_HOST='ghcr.io', GHCR_NAMESPACE='acme',
                GHCR_APPROVED_REPO='ghcr.io/acme/approved/eclipse-temurin',
                GHCR_QUARANTINE_REPO='ghcr.io/acme/quarantine/eclipse-temurin')
    APP = dict(GHCR_HOST='ghcr.io', GHCR_NAMESPACE='acme', APP_NAME='myapp',
               APP_CANDIDATE_REPO='ghcr.io/acme/application-candidates/myapp',
               APP_RELEASE_REPO='ghcr.io/acme/applications/myapp',
               APPROVED_PREFIX='ghcr.io/acme/approved/')

    def run_validator(self, mode, data):
        return subprocess.run(['bash', str(self.SCRIPT), mode], env={**os.environ, **data},
                              capture_output=True, text=True)

    def test_valid_examples(self):
        self.assertEqual(self.run_validator('base', self.BASE).returncode, 0)
        self.assertEqual(self.run_validator('app', self.APP).returncode, 0)

    def test_rejects_wrong_registry_namespace_or_package_name(self):
        cases = [
            ('base', {**self.BASE, 'GHCR_HOST': 'docker.io'}),
            ('base', {**self.BASE, 'GHCR_NAMESPACE': 'Acme'}),
            ('base', {**self.BASE, 'GHCR_APPROVED_REPO': 'ghcr.io/acme/approved-evil/eclipse-temurin'}),
            ('app', {**self.APP, 'APP_NAME': '../escape'}),
            ('app', {**self.APP, 'APP_RELEASE_REPO': 'ghcr.io/acme/quarantine/myapp'}),
        ]
        for mode, data in cases:
            with self.subTest(mode=mode, data=data):
                self.assertNotEqual(self.run_validator(mode, data).returncode, 0)

if __name__ == '__main__':
    unittest.main()
