"""Adversarial regressions for GHCR v6 (independent layer validation and approval migration)."""
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'ci'))
sys.path.insert(0, str(ROOT/'scripts'))
import image_tar_identity as identity
import environment_approver
import check_application_vulnerabilities as vulns
from test_v3_fixes import archive, layer, TAG


class ArchiveSecurityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.base = layer([('base/a.txt', 'file', b'base')])
        self.app = layer([('opt/app/app.jar', 'file', b'correct')])

    def tearDown(self):
        self.tmp.cleanup()

    def test_both_honest_archives_have_matching_verified_layers(self):
        a, b = self.root/'a.tar', self.root/'b.tar'
        archive(a, [self.base, self.app])
        archive(b, [self.base, self.app])
        ia, ib = identity.identity(a, TAG), identity.identity(b, TAG)
        self.assertEqual(ia['config_digest'], ib['config_digest'])
        self.assertEqual(ia['diff_ids'], ib['diff_ids'])

    def test_second_builder_forged_layer_with_same_config_is_rejected(self):
        """A valid config digest may name fabricated diff_ids that don't match layer bytes."""
        good, forged = self.root/'good.tar', self.root/'forged.tar'
        good_config = archive(good, [self.base, self.app])
        modified = layer([('opt/app/app.jar', 'file', b'ATTACKER-CONTENT')])
        forged_config = archive(forged, [self.base, modified],
                                diff_ids=[self.base[1], self.app[1]])
        self.assertEqual(good_config, forged_config)  # same attested config is not enough
        self.assertEqual(identity.identity(good, TAG)['config_digest'], good_config)
        with self.assertRaisesRegex(ValueError, 'does not match diff_id'):
            identity.identity(forged, TAG)

    def test_forged_base_layer_rejected_even_when_app_layer_is_valid(self):
        forged_base = layer([('base/a.txt', 'file', b'wrong')])
        tar = self.root/'img.tar'
        archive(tar, [forged_base, self.app], diff_ids=[self.base[1], self.app[1]])
        with self.assertRaisesRegex(ValueError, 'does not match diff_id'):
            identity.identity(tar, TAG)

    def test_repeated_identical_layer_reference_is_valid(self):
        tar = self.root/'img.tar'
        archive(tar, [self.base, self.base])
        self.assertEqual(identity.identity(tar, TAG)['diff_ids'], [self.base[1], self.base[1]])

    def test_gzip_layer_verified_on_uncompressed_bytes(self):
        archive_path = self.root/'img.tar'
        zipped = layer([('opt/hello.txt', 'file', b'hello')], compression='gzip')
        archive(archive_path, [self.base, zipped])
        self.assertEqual(identity.identity(archive_path, TAG)['diff_ids'],
                         [self.base[1], zipped[1]])

    def test_unsupported_zstd_layer_rejected(self):
        tar = self.root/'image.tar'
        unsupported = layer([('opt/hello.txt', 'file', b'hello')], compression='zstd')
        archive(tar, [self.base, unsupported])
        with self.assertRaisesRegex(ValueError, 'zstd'):
            identity.identity(tar, TAG)

    def test_layer_verification_budget_fails_closed(self):
        tar = self.root/'image.tar'
        archive(tar, [self.base])
        original = identity.MAX_LAYER_UNCOMPRESSED
        try:
            identity.MAX_LAYER_UNCOMPRESSED = 8
            with self.assertRaisesRegex(ValueError, 'byte budget'):
                identity.identity(tar, TAG)
        finally:
            identity.MAX_LAYER_UNCOMPRESSED = original

    def test_pipeline_checks_both_builder_archives(self):
        text = (ROOT/'ci/application_pipeline.sh').read_text()
        self.assertIn('check_builder_output image-a', text)
        self.assertIn('check_builder_output image-b', text)
        self.assertIn('cmp image-a/verified-diff-ids.json image-b/verified-diff-ids.json', text)


class ApprovalSecurityTests(unittest.TestCase):
    def test_reordered_base_layers_rejected(self):
        first = 'sha256:'+'a'*64
        second = 'sha256:'+'b'*64
        with tempfile.TemporaryDirectory() as temp:
            path=pathlib.Path(temp)/'overlay.json'
            path.write_text(json.dumps({
                'schema': vulns.OVERLAY_SCHEMA,
                'config_digest': 'sha256:'+'1'*64,
                'base_diff_ids': [second, first],
                'additive': True,
            }))
            with self.assertRaisesRegex(ValueError, 'different base'):
                vulns.load_layer_overlay(path, [first, second], 'sha256:'+'1'*64)
            path.write_text(json.dumps({
                'schema': vulns.OVERLAY_SCHEMA,
                'config_digest': 'sha256:'+'1'*64,
                'base_diff_ids': [first, second],
                'additive': True,
            }))
            self.assertTrue(vulns.load_layer_overlay(path, [first, second], 'sha256:'+'1'*64))

    def test_original_actor_cannot_approve_rerun(self):
        record=[{'state':'approved','user':{'login':'Alice'},
                 'environments':[{'name':'base-manual-approval'}]}]
        with self.assertRaisesRegex(ValueError, 'cannot approve'):
            environment_approver.approver(record,'base-manual-approval','bob','alice')
        with self.assertRaisesRegex(ValueError, 'cannot approve'):
            environment_approver.approver(record,'base-manual-approval','alice','bob')
        self.assertEqual(environment_approver.approver(record,'base-manual-approval','bob','carol'),'Alice')

    def test_workflows_pass_both_actors(self):
        for name in ('base-image-approval.yml','application-release.yml'):
            wf=(ROOT/'.github/workflows'/name).read_text()
            self.assertIn('--actor "$GITHUB_ACTOR"', wf)
            self.assertIn('--triggering-actor "$GITHUB_TRIGGERING_ACTOR"', wf)

    def test_historical_approval_versions_not_app_consumption(self):
        config=json.loads((ROOT/'policy/config.json').read_text())
        self.assertEqual(config['accepted_approval_policy_versions'], [config['version']])
        self.assertIn('2026-11-ghcr-v5', config['historical_baseline_policy_versions'])
        self.assertNotIn('2026-11-ghcr-v5', config['accepted_approval_policy_versions'])
        self.assertIn('--expected-policy-sha256', (ROOT/'scripts/verify_bases.sh').read_text())
        self.assertIn('--field historical_baseline_versions', (ROOT/'ci/base_evaluate.sh').read_text())
        self.assertIn('--field historical_baseline_versions', (ROOT/'ci/base_promote.sh').read_text())

    def test_policy_age_windows_separated(self):
        config=json.loads((ROOT/'policy/config.json').read_text())
        self.assertLess(config['approval_max_age_hours'], config['historical_baseline_max_age_hours'])
        for name in ('ci/base_evaluate.sh','ci/base_promote.sh'):
            self.assertIn('--field historical_baseline_max_age_hours', (ROOT/name).read_text())


if __name__=='__main__':
    unittest.main()
