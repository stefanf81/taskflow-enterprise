"""Negative security regressions added after the GHCR v3 full security code review."""
import datetime
import hashlib
import importlib.util
import io
import json
import pathlib
import sys
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ci'))
sys.path.insert(0, str(ROOT / 'scripts'))
from test_v3_fixes import layer, archive
import check_additive_layers as additive
import audit_repo_settings as audit
import image_tar_identity as ident
import install_verified_tools as tools
import check_approval_attestation as attest
from policy_fingerprint import fingerprint

class WhiteoutRegressionTests(unittest.TestCase):
    def check(self, base, app):
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d)/'image.tar'
            baseline = layer(base)
            later = layer(app)
            archive(path, [baseline, later])
            return additive.analyse(path, {'rootfs': {'diff_ids': [baseline[1]]}})

    def test_whiteout_removes_implicit_directory_and_children(self):
        report = self.check([('opt/java/vulnerable.so', 'file', b'x')], [('.wh.opt', 'file', b'')])
        self.assertFalse(report['additive'])
        self.assertTrue(any('whiteout deletes' in reason for reason in report['violations']))

    def test_nested_whiteout_removes_implicit_parent(self):
        report = self.check([('opt/java/lib/a.so', 'file', b'x')], [('opt/.wh.java', 'file', b'')])
        self.assertFalse(report['additive'])

    def test_base_inferred_ancestor_replaced_by_file_is_not_additive(self):
        report = self.check([('opt/java/lib/a.so', 'file', b'x')], [('opt/java', 'file', b'bad')])
        self.assertFalse(report['additive'])

    def test_parent_directory_redeclaration_with_unknown_original_metadata_is_not_additive(self):
        report = self.check([('opt/java/lib/a.so', 'file', b'x')], [('opt/', 'dir', None)])
        self.assertFalse(report['additive'])

    def test_genuinely_additive_new_tree(self):
        report = self.check([('opt/java/lib/a.so', 'file', b'x')], [('app/secure.jar', 'file', b'jar')])
        self.assertTrue(report['additive'], report['violations'])

    def test_opaque_whiteout_over_implicit_directory(self):
        report = self.check([('opt/java/lib/a.so', 'file', b'x')], [('opt/java/.wh..wh..opq', 'file', b'')])
        self.assertFalse(report['additive'])

    def test_member_limit_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            archive_path = pathlib.Path(d)/'image.tar'
            base=layer([('one', 'file', b'a')])
            app=layer([('two', 'file', b'b')])
            archive(archive_path, [base, app])
            old=additive.MAX_LAYER_ENTRIES
            try:
                additive.MAX_LAYER_ENTRIES=0
                # v5: over budget = "not additive" (no inherited exceptions), not a failed release.
                report=additive.analyse(archive_path, {'rootfs': {'diff_ids': [base[1]]}})
                self.assertFalse(report['additive'])
                self.assertIn('excessive TAR', report['violations'][0])
            finally:
                additive.MAX_LAYER_ENTRIES=old

class BranchProtectionTests(unittest.TestCase):
    def settings(self):
        from test_v3_fixes import Finding13RepositorySettingsAuditTests
        return Finding13RepositorySettingsAuditTests().good()

    def test_creation_only_rules_do_not_protect_main(self):
        settings=self.settings()
        settings.pop('main_branch_protection')
        self.assertTrue(any('main branch update' in f for f in audit.audit(settings)))

    def test_valid_pr_ruleset_with_checks_and_reviews_can_protect_main(self):
        settings=self.settings()
        settings.pop('main_branch_protection')
        settings['rulesets'].append({'target':'branch','enforcement':'active',
            'conditions':{'ref_name':{'include':['refs/heads/main'],'exclude':[]}},
            'bypass_actors':[], 'rules':[
                {'type':'pull_request','parameters':{'required_approving_review_count':2,'dismiss_stale_reviews_on_push':True}},
                {'type':'required_status_checks','parameters':{'required_status_checks':[{'context':'Security repository PR validation (no secrets) / unit-tests'}]}},
                {'type':'deletion'}]})
        self.assertFalse(any('main branch update' in f for f in audit.audit(settings)))

    def test_bypass_actors_invalidates_ruleset(self):
        settings=self.settings();settings.pop('main_branch_protection')
        settings['rulesets'].append({'target':'branch','enforcement':'active',
            'conditions':{'ref_name':{'include':['~DEFAULT_BRANCH'],'exclude':[]}},
            'bypass_actors':[{'actor_id':1,'actor_type':'Team','bypass_mode':'always'}],
            'rules':[{'type':'pull_request','parameters':{'required_approving_review_count':2,'dismiss_stale_reviews_on_push':True}},
                {'type':'required_status_checks','parameters':{'required_status_checks':[{'context':'pr'}]}},
                {'type':'deletion'}]})
        self.assertTrue(any('main branch update' in f for f in audit.audit(settings)))

class PolicyFingerprintTests(unittest.TestCase):
    def test_changes_to_policy_code_change_fingerprint_without_version_bump(self):
        with tempfile.TemporaryDirectory() as directory:
            import shutil
            root=pathlib.Path(directory)/'repo'
            for d in ('policy','scripts','ci','.github'):
                shutil.copytree(ROOT/d, root/d, ignore=shutil.ignore_patterns('__pycache__'))
            a=fingerprint(root)
            with open(root/'scripts/evaluate.py','a') as f:
                f.write('\n# changed gate logic\n')
            self.assertNotEqual(a,fingerprint(root))

    def test_wrong_policy_content_hash_rejected_even_if_version_matches(self):
        decision={'schema':'p','approved_ref':'ghcr.io/o/repo@sha256:'+'a'*64,'policy_version':'2026',
            'policy_sha256':'1'*64,'timestamp_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'decision':'AUTO_PASS','approver':'automatic-policy','decision_report_sha256':'2'*64,
            'evidence_sha256':{'decision.json':'2'*64},'git_commit':'3'*40,'build_url':'https://github.com/o/r/actions/runs/1'}
        stmt={'predicateType':'p','predicate':decision,'subject':[{'name':'ghcr.io/o/repo','digest':{'sha256':'a'*64}}]}
        reasons=attest.problems_with(stmt,'p','sha256:'+'a'*64,decision['approved_ref'],['2026'],168, '4'*64)
        self.assertTrue(any('policy content hash' in reason for reason in reasons))

class PinnedInstallerTests(unittest.TestCase):
    def one(self, blob=b'#!/bin/sh\necho sample\n'):
        return {'schema':2,'platform':'linux/amd64','tools':{'crane':{'version':'v0.22.1',
            'url':'https://github.com/google/go-containerregistry/releases/download/v0.22.1/example',
            'sha256':hashlib.sha256(blob).hexdigest(),'size':len(blob),'format':'raw','member':'crane'}}}

    def test_unconfigured_hash_fails_before_any_download(self):
        lock=self.one();lock['tools']['crane']['sha256']='REPLACE_WITH_64_HEX_SHA256'
        with self.assertRaisesRegex(ValueError,'genuine SHA-256'):
            tools.validate_lock(lock, {'crane'})

    def test_bad_checksum_cannot_install(self):
        lock=self.one(b'legitimate');lock['tools']['crane']['sha256']='0'*64
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,'differs from protected lock'):
                tools.install(lock,{'crane'},d,lambda url: b'legitimate')

    def test_verified_artifact_installs_without_running_remote_scripts(self):
        content=b'#!/bin/sh\necho sample\n';lock=self.one(content)
        with tempfile.TemporaryDirectory() as d:
            installed=tools.install(lock,{'crane'},d,lambda url: content)
            self.assertEqual((installed/'crane').read_bytes(),content)

    def test_latest_disallowed(self):
        lock=self.one();lock['tools']['crane']['url']='https://github.com/o/r/releases/download/latest/binary'
        with self.assertRaisesRegex(ValueError, 'non-latest'):
            tools.validate_lock(lock, {'crane'})

    def test_workflow_installs_tools_before_use(self):
        for f in ('base-image-approval.yml','application-release.yml'):
            text=(ROOT/'.github/workflows'/f).read_text()
            self.assertIn('ci/install_verified_tools.py --kind',text)

if __name__=='__main__': unittest.main()
