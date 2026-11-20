"""Static checks for GitHub Actions trust boundaries and workflow wiring.

These do NOT substitute for actionlint or executing workflows in staging.
"""
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
WF=ROOT/'.github/workflows'
try:
    import yaml
except ImportError:
    yaml=None

@unittest.skipIf(yaml is None,'PyYAML unavailable; validate workflow YAML separately')
class WorkflowSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files={f.name:yaml.safe_load(f.read_text()) for f in WF.glob('*.yml')}

    def test_every_workflow_parses(self):
        self.assertEqual(set(self.files),{'application-release.yml','base-bootstrap.yml','base-image-approval.yml','security-pr.yml'})
        for name,d in self.files.items():
            self.assertTrue(d['jobs'],name)

    def test_no_privileged_pr_run(self):
        for name in ('application-release.yml','base-bootstrap.yml','base-image-approval.yml'):
            data=(WF/name).read_text()
            self.assertNotIn('pull_request_target:',data)
            self.assertNotIn('workflow_run:',data)
            self.assertIn("github.ref == 'refs/heads/main'",data)
        pr=self.files['security-pr.yml']
        self.assertEqual(pr['permissions'],{'contents':'read'})
        self.assertNotIn('secrets.',(WF/'security-pr.yml').read_text())

    def test_least_privilege_from_app_to_signer(self):
        d=self.files['application-release.yml']['jobs']
        self.assertEqual(set(d),{'authorize','compile','image_build','scan','push_candidate','high_review',
                                 'promote','independent_rescan','independent_verification','sign'})
        self.assertEqual(d['sign']['environment'],'ghcr-application-signing')
        self.assertEqual(d['independent_verification']['environment'],'independent-verification')
        self.assertNotIn('id-token: write',(WF/'security-pr.yml').read_text())
        self.assertRegex((WF/'application-release.yml').read_text(),r'actions/attest@[0-9a-f]{40} # v4\.')
        self.assertIn('image-identity-a',(WF/'application-release.yml').read_text())
        self.assertIn('image-identity-b',(WF/'application-release.yml').read_text())

    def test_evaluate_and_protect_promotion(self):
        d=self.files['base-image-approval.yml']['jobs']
        self.assertEqual(d['quarantine']['environment'],'ghcr-quarantine')
        self.assertNotIn('environment',d['evaluate'])
        self.assertIn('base-manual-approval',d['promote']['environment'])
        self.assertIn('base-auto-promotion',d['promote']['environment'])

    def test_scripts_require_actual_release_gate_and_signer(self):
        src=(ROOT/'ci/application_pipeline.sh').read_text()
        self.assertIn('--max-issued-age-minutes 10',src)
        self.assertIn('ci/check_registry_config.py',src)
        self.assertIn('independent_scan_attestation.py --verify',src)
        self.assertIn('gh attestation verify',src)
        self.assertIn('cosign sign "${COSIGN_SIGN_FLAGS[@]}"',src)
        self.assertIn('check_builder_output image-a',src)
        self.assertIn('check_builder_output image-b',src)
        self.assertIn('image-identity-b/config-digest.txt',src)

if __name__=='__main__':unittest.main()
