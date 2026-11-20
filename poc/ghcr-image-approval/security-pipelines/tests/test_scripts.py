import argparse
import base64
import datetime
import io
import json
import pathlib
import sys
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from approval_record import build_record  # noqa: E402
from check_approval_attestation import check  # noqa: E402
from check_dockerfile_bases import base_images  # noqa: E402
from inventory_fs import inventory  # noqa: E402
from manifest_platforms import compare as compare_platforms, platforms  # noqa: E402
from parse_from import parse  # noqa: E402

DIGEST = 'sha256:' + 'a' * 64
PTYPE = 'https://example.org/container-image-approval/v1'


def make_tar(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tf:
        for name, mode, kind, payload in entries:
            info = tarfile.TarInfo(name)
            info.mode = mode
            if kind == 'sym':
                info.type, info.linkname = tarfile.SYMTYPE, payload
                tf.addfile(info)
            elif kind == 'hard':
                info.type, info.linkname = tarfile.LNKTYPE, payload
                tf.addfile(info)
            else:
                info.size = len(payload)
                tf.addfile(info, io.BytesIO(payload))
    return io.BytesIO(buf.getvalue())


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.result = inventory(make_tar([
            ('usr/bin/program', 0o755, 'file', b'content'),
            ('etc/readme', 0o644, 'file', b'text'),
            ('tmp/suid', 0o4755, 'file', b'content'),
            ('usr/bin/sudo', 0o4755, 'file', b'sudo'),
            ('usr/local/bin/rootsh', 0o4755, 'hard', 'usr/bin/sudo'),
            ('usr/lib/libhelper.so.1', 0o644, 'file', b'\x7fELF....'),
            ('opt/app/run', 0o644, 'file', b'#!/bin/sh\necho hi\n'),
            ('./.hidden-tool', 0o755, 'file', b'x'),
            ('etc/ld.so.preload', 0o777, 'sym', '/tmp/x.so'),
            ('usr/bin/javac', 0o777, 'sym', '../../tmp/evil'),
            ('etc/passwd', 0o644, 'file', b'root:x:0:0'),
        ]))

    def test_exec_and_non_exec(self):
        self.assertIn('usr/bin/program', self.result['files'])
        self.assertIn('etc/readme', self.result['files'])
        self.assertFalse(self.result['files']['etc/readme']['is_code'])
        self.assertTrue(self.result['files']['tmp/suid']['suid_or_sgid'])

    def test_hidden_file_name_preserved(self):
        self.assertIn('.hidden-tool', self.result['files'])
        self.assertNotIn('hidden-tool', self.result['files'])

    def test_hardlink_to_suid_binary_is_visible(self):
        item = self.result['files']['usr/local/bin/rootsh']
        self.assertTrue(item['suid_or_sgid'])
        self.assertEqual(item['hardlink_to'], 'usr/bin/sudo')
        self.assertEqual(item['sha256'], self.result['files']['usr/bin/sudo']['sha256'])

    def test_elf_library_and_script_without_exec_bit_are_code(self):
        self.assertIn('usr/lib/libhelper.so.1', self.result['files'])
        self.assertIn('opt/app/run', self.result['files'])

    def test_symlinks_recorded_and_sensitive(self):
        self.assertEqual(self.result['symlinks']['usr/bin/javac'], '../../tmp/evil')
        self.assertEqual(self.result['sensitive_files']['etc/ld.so.preload'], {'symlink_to': '/tmp/x.so'})
        self.assertIn('etc/passwd', self.result['sensitive_files'])


class ParseFromTests(unittest.TestCase):
    def write(self, text):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        p = pathlib.Path(d.name) / 'Dockerfile'
        p.write_text(text)
        return p

    def test_fail_closed_and_fields(self):
        with self.assertRaises(ValueError):
            parse(self.write('FROM eclipse-temurin:21-jre-resolute\n'))
        with self.assertRaises(ValueError):
            parse(self.write('FROM malicious/image:1@' + DIGEST + '\n'))
        with self.assertRaises(ValueError):
            parse(self.write('FROM\n'))
        result = parse(self.write('FROM eclipse-temurin:21-jre-resolute@' + DIGEST + '\n'))
        self.assertEqual(result['digest'], DIGEST)
        self.assertEqual(result['upstream_digest_ref'], 'docker.io/library/eclipse-temurin@' + DIGEST)
        self.assertNotIn(':21-jre', result['upstream_digest_ref'])

    def test_catalog_file_has_one_from(self):
        text = (ROOT / 'catalog/Dockerfile.temurin').read_text()
        self.assertEqual(sum(1 for line in text.splitlines() if line.strip().upper().startswith('FROM')), 1)


class ManifestPlatformTests(unittest.TestCase):
    def index(self, manifests):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        p = pathlib.Path(d.name) / 'index.json'
        p.write_text(json.dumps({'manifests': manifests}))
        return p

    def test_enumeration_skips_attestations(self):
        p = self.index([
            {'platform': {'os': 'linux', 'architecture': 'amd64'}},
            {'platform': {'os': 'linux', 'architecture': 'arm', 'variant': 'v7'}},
            {'platform': {'os': 'unknown', 'architecture': 'unknown'}},
            {'platform': {'os': 'linux', 'architecture': 'amd64'},
             'annotations': {'vnd.docker.reference.type': 'attestation-manifest'}},
        ])
        self.assertEqual(platforms(p), {'linux/amd64', 'linux/arm/v7'})

    def test_drift_and_non_linux_fail_closed(self):
        a = self.index([{'platform': {'os': 'linux', 'architecture': 'amd64'}}])
        b = self.index([{'platform': {'os': 'linux', 'architecture': 'amd64'}},
                        {'platform': {'os': 'linux', 'architecture': 'arm64', 'variant': 'v8'}}])
        with self.assertRaises(ValueError):
            compare_platforms(a, b)
        with self.assertRaises(ValueError):
            platforms(self.index([{'platform': {'os': 'windows', 'architecture': 'amd64'}}]))


class ApprovalRecordTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tempdir.name)
        (self.dir / 'old-linux-amd64.syft.json').write_text('{}')

    def tearDown(self):
        self.tempdir.cleanup()

    def args(self, decision, approver):
        (self.dir / 'decision.json').write_text(json.dumps(
            {'decision': decision, 'policy_version': 'v', 'upstream_signature': 'not_verified'}))
        return argparse.Namespace(
            decision_file=str(self.dir / 'decision.json'), evidence_dir=str(self.dir),
            upstream_ref='u', approved_ref='h/approved/x@' + DIGEST, approver=approver,
            build_url='b', git_commit='c', predicate_type=PTYPE, output=str(self.dir / 'approval.json'))

    def test_review_requires_human(self):
        with self.assertRaises(ValueError):
            build_record(self.args('REVIEW', 'automatic-policy'))
        with self.assertRaises(ValueError):
            build_record(self.args('REVIEW', ''))
        record = build_record(self.args('REVIEW', 'alice'))
        self.assertEqual(record['approver'], 'alice')

    def test_block_and_mismatched_auto_pass_rejected(self):
        with self.assertRaises(ValueError):
            build_record(self.args('BLOCK', 'alice'))
        with self.assertRaises(ValueError):
            build_record(self.args('AUTO_PASS', 'alice'))

    def test_evidence_is_hashed(self):
        record = build_record(self.args('AUTO_PASS', 'automatic-policy'))
        self.assertIn('old-linux-amd64.syft.json', record['evidence_sha256'])
        self.assertIn('decision.json', record['evidence_sha256'])
        self.assertNotIn('approval.json', record['evidence_sha256'])


def envelope(predicate, digest=DIGEST, ptype=PTYPE):
    statement = {'_type': 'https://in-toto.io/Statement/v0.1', 'predicateType': ptype,
                 'subject': [{'name': 'h/approved/x', 'digest': {'sha256': digest.split(':')[1]}}],
                 'predicate': predicate}
    return json.dumps({'payloadType': 'application/vnd.in-toto+json',
                       'payload': base64.b64encode(json.dumps(statement).encode()).decode()})


class AttestationCheckTests(unittest.TestCase):
    def predicate(self, **kw):
        p = {'decision': 'REVIEW', 'approver': 'alice', 'approved_ref': 'h/approved/x@' + DIGEST,
             'schema': PTYPE, 'policy_version': '2026-11-demo-v3',
             'decision_report_sha256': 'a' * 64, 'evidence_sha256': {'decision.json': 'a' * 64},
             'git_commit': 'a' * 40, 'build_url': 'https://jenkins.invalid/job/1',
             'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        p.update(kw)
        return p

    def test_valid(self):
        self.assertEqual(check(envelope(self.predicate()), PTYPE, DIGEST)['approver'], 'alice')

    def test_wrapped_custom_predicate(self):
        wrapped = {'Data': json.dumps(self.predicate()), 'Timestamp': 'now'}
        self.assertEqual(check(envelope(wrapped), PTYPE, DIGEST)['decision'], 'REVIEW')

    def test_rejections(self):
        bad = [envelope(self.predicate(decision='BLOCK')),
               envelope(self.predicate(approver='automatic-policy')),
               envelope(self.predicate(), digest='sha256:' + 'b' * 64),
               envelope(self.predicate(), ptype='https://cosign.sigstore.dev/attestation/v1'),
               '']
        for text in bad:
            with self.assertRaises(ValueError):
                check(text, PTYPE, DIGEST)

    def test_one_good_among_bad_is_accepted(self):
        text = envelope(self.predicate(decision='BLOCK')) + '\n' + envelope(self.predicate())
        check(text, PTYPE, DIGEST)

    def test_reject_wrong_approved_repository_even_with_matching_digest(self):
        with self.assertRaises(ValueError):
            check(envelope(self.predicate()), PTYPE, DIGEST,
                  expected_ref='h/approved/different@' + DIGEST, accepted_policy_versions=['2026-11-demo-v3'])

    def test_reject_wrong_policy_version(self):
        with self.assertRaises(ValueError):
            check(envelope(self.predicate(policy_version='outdated')), PTYPE, DIGEST,
                  expected_ref='h/approved/x@' + DIGEST, accepted_policy_versions=['2026-11-demo-v3'])

    def test_reject_expired_attestation(self):
        date = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)
        with self.assertRaises(ValueError):
            check(envelope(self.predicate(timestamp_utc=date.isoformat())), PTYPE, DIGEST,
                  expected_ref='h/approved/x@' + DIGEST, accepted_policy_versions=['2026-11-demo-v3'])


class DockerfileBaseTests(unittest.TestCase):
    PREFIX = 'ghcr.io/example-org/approved/'

    def test_approved_multistage(self):
        text = (f'FROM --platform=linux/amd64 {self.PREFIX}maven:3-jdk21@{DIGEST} AS build\n'
                f'FROM {self.PREFIX}eclipse-temurin:21-jre-resolute@{DIGEST}\n'
                'COPY --from=build /x /x\n'
                'FROM build AS again\n')
        self.assertEqual(base_images(text, self.PREFIX),
                         [f'{self.PREFIX}maven@{DIGEST}', f'{self.PREFIX}eclipse-temurin@{DIGEST}'])

    def test_rejections(self):
        for text in [f'FROM docker.io/library/eclipse-temurin:21@{DIGEST}\n',
                     f'FROM {self.PREFIX}eclipse-temurin:21-jre-resolute\n',
                     'ARG BASE\nFROM $BASE\n',
                     f'FROM ghcr.io/example-org/approved-evil/x@{DIGEST}\n',
                     f'FROM {self.PREFIX}x@sha256:REPLACE_WITH_64_HEX_CHARACTERS\n',
                     '']:
            with self.assertRaises(ValueError, msg=text):
                base_images(text, self.PREFIX)

    def test_import_bypasses_are_rejected(self):
        base = f'FROM {self.PREFIX}x@{DIGEST} AS base\n'
        for line in [
            'COPY --from=alpine:latest /bin/sh /bin/sh',
            'ADD https://example.invalid/file /file',
            'RUN --mount=type=bind,from=docker.io/library/alpine:latest echo hi',
            '# syntax=docker/dockerfile:1',
        ]:
            with self.assertRaises(ValueError, msg=line):
                base_images(base + line + '\n', self.PREFIX)

    def test_stage_references_remain_valid(self):
        base = f'FROM {self.PREFIX}x@{DIGEST} AS builder\nCOPY --from=builder /x /x\n'
        self.assertEqual(base_images(base, self.PREFIX), [f'{self.PREFIX}x@{DIGEST}'])

    def test_example_application_dockerfile_fails_until_pinned(self):
        with self.assertRaises(ValueError):
            base_images((ROOT / 'examples/Dockerfile.application').read_text(), self.PREFIX)


if __name__ == '__main__':
    unittest.main()
