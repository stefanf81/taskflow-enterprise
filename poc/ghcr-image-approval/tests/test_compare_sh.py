"""Run scripts/compare.sh end to end against stub crane/syft/grype/diffoci binaries."""
import io
import json
import os
import pathlib
import stat
import subprocess
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

STUBS = {
    'crane': '#!/usr/bin/env bash\ncase "$1" in\n  config) echo \'{"config":{}}\' ;;\n'
             '  export) cat "$STUB_TAR" ;;\n  *) exit 3 ;;\nesac\n',
    'syft': '#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in syft-json=*) '
            'echo \'{"artifacts":[]}\' > "${a#syft-json=}" ;; esac; done\n',
    'grype': '#!/usr/bin/env bash\necho \'{"matches":[]}\'\n',
    'diffoci': '#!/usr/bin/env bash\necho "some differences"\nexit "${DIFFOCI_RC:-1}"\n',
}


class CompareShTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.tmp = pathlib.Path(self.tempdir.name)
        bindir = self.tmp / 'bin'
        bindir.mkdir()
        for name, body in STUBS.items():
            path = bindir / name
            path.write_text(body)
            path.chmod(path.stat().st_mode | stat.S_IEXEC)
        tar_path = self.tmp / 'image.tar'
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w') as tf:
            info = tarfile.TarInfo('usr/bin/java')
            info.mode, info.size = 0o755, 4
            tf.addfile(info, io.BytesIO(b'java'))
        tar_path.write_bytes(buf.getvalue())
        self.env = dict(os.environ, PATH=f'{bindir}:{os.environ["PATH"]}', STUB_TAR=str(tar_path),
                        OLD_REF='h/approved/x@sha256:' + 'a' * 64, CANDIDATE_REF='h/quarantine/x@sha256:' + 'b' * 64,
                        PLATFORMS='linux/amd64,linux/arm64/v8', REPORT_DIR=str(self.tmp / 'reports'))

    def tearDown(self):
        self.tempdir.cleanup()

    def run_compare(self, **overrides):
        env = dict(self.env, **overrides)
        env = {k: v for k, v in env.items() if v is not None}
        return subprocess.run(['bash', str(ROOT / 'scripts/compare.sh')], env=env, cwd=self.tmp,
                              capture_output=True, text=True)

    def test_differences_found_is_not_a_failure(self):
        result = self.run_compare()
        self.assertEqual(result.returncode, 0, result.stderr)
        for suffix in ('linux-amd64', 'linux-arm64-v8'):
            fs = json.loads((self.tmp / 'reports' / f'candidate-{suffix}.fs.json').read_text())
            self.assertIn('usr/bin/java', fs['files'])
            self.assertTrue((self.tmp / 'reports' / f'diffoci-{suffix}.txt').exists())

    def test_diffoci_operational_error_fails(self):
        self.assertNotEqual(self.run_compare(DIFFOCI_RC='2').returncode, 0)

    def test_missing_report_dir_or_platforms_fails(self):
        self.assertNotEqual(self.run_compare(REPORT_DIR=None).returncode, 0)
        self.assertNotEqual(self.run_compare(PLATFORMS='').returncode, 0)
        self.assertNotEqual(self.run_compare(PLATFORMS='linux/amd64,').returncode, 0)


if __name__ == '__main__':
    unittest.main()
