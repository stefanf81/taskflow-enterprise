"""Reproducible build check against a REAL Docker daemon (skipped when none is reachable).

Builds the same Dockerfile from two separate copies of the context, whose file modification
times differ (as with two fresh checkouts on two agents), using scripts/reproducible_build.sh.
Both image IDs must be identical, and must survive docker save/load (the hand-over to the
publisher). As a control, the v5 command (`docker build` with only SOURCE_DATE_EPOCH) must
produce DIFFERENT IDs: if that ever stops being true, the explanation in the script is stale.
"""
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
EPOCH = '1763064000'
DOCKERFILE = '''FROM scratch
WORKDIR /opt/app
COPY target/app.jar /opt/app/app.jar
USER 10001:10001
ENTRYPOINT ["java", "-jar", "/opt/app/app.jar"]
'''


def docker_available():
    if not shutil.which('docker'):
        return False
    try:
        result = subprocess.run(['docker', 'info', '--format', '{{json .DriverStatus}}'],
                                capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and 'io.containerd.snapshotter' in result.stdout


def run(*args, **kw):
    return subprocess.run(list(args), capture_output=True, text=True, timeout=300, **kw)


@unittest.skipUnless(docker_available(), 'needs a Docker daemon with the containerd image store')
class ReproducibleBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.images = []
        src = self.dir / 'src'
        (src / 'target').mkdir(parents=True)
        (src / 'target' / 'app.jar').write_bytes(os.urandom(100_000))
        (src / 'Dockerfile').write_text(DOCKERFILE)
        self.contexts = []
        for name in ('agent1', 'agent2'):
            ctx = self.dir / name
            shutil.copytree(src, ctx)  # fresh mtimes, like a new checkout + unstash
            self.contexts.append(ctx)
            time.sleep(1.1)

    def tearDown(self):
        if self.images:
            run('docker', 'image', 'rm', '-f', *self.images)
        self.tmp.cleanup()

    def image(self):
        name = f'repro-test-{uuid.uuid4().hex[:12]}:latest'
        self.images.append(name)
        return name

    def script_build(self, ctx):
        image, evidence = self.image(), ctx / 'evidence'
        result = run('bash', str(ROOT / 'scripts/reproducible_build.sh'), str(ctx), str(ctx / 'Dockerfile'),
                     image, EPOCH, str(evidence))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('docker-server=', (evidence / 'builder-versions.txt').read_text())
        return image, (evidence / 'image-id.txt').read_text().strip()

    def test_two_honest_builds_match_and_survive_save_load(self):
        image1, id1 = self.script_build(self.contexts[0])
        time.sleep(2)
        _image2, id2 = self.script_build(self.contexts[1])
        self.assertEqual(id1, id2)
        tar = self.dir / 'image.tar'
        self.assertEqual(run('docker', 'save', '-o', str(tar), image1).returncode, 0)
        self.assertEqual(run('docker', 'image', 'rm', image1).returncode, 0)
        self.assertEqual(run('docker', 'load', '-i', str(tar)).returncode, 0)
        loaded = run('docker', 'image', 'inspect', '--format', '{{.Id}}', image1).stdout.strip()
        self.assertEqual(loaded, id1)

    def test_attested_identity_is_the_config_digest_not_the_image_id(self):
        """v2 regression: `.Id` is the OCI manifest digest on the containerd store, so it can
        never equal a registry manifest's config.digest. Builders now attest the config
        digest read from the saved archive, which is identical for two honest builds."""
        import importlib.util
        spec = importlib.util.spec_from_file_location('tar_identity', ROOT / 'ci/image_tar_identity.py')
        tar_identity = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tar_identity)
        configs = []
        for ctx in self.contexts:
            image, image_id = self.script_build(ctx)
            tar = ctx / 'image.tar'
            self.assertEqual(run('docker', 'save', '-o', str(tar), image).returncode, 0)
            result = tar_identity.identity(tar, image)
            self.assertNotEqual(result['config_digest'], image_id)
            self.assertEqual(result['manifest_digest'], image_id)
            configs.append(result['config_digest'])
            time.sleep(2)
        self.assertEqual(configs[0], configs[1])

    def test_v5_command_was_not_reproducible(self):
        ids = []
        for ctx in self.contexts:
            image = self.image()
            result = run('docker', 'build', '-q', '--pull', '--no-cache', '--network=none',
                         '--build-arg', f'SOURCE_DATE_EPOCH={EPOCH}', '-f', str(ctx / 'Dockerfile'),
                         '-t', image, str(ctx), env=dict(os.environ, DOCKER_BUILDKIT='1'))
            self.assertEqual(result.returncode, 0, result.stderr)
            ids.append(run('docker', 'image', 'inspect', '--format', '{{.Id}}', image).stdout.strip())
            time.sleep(2)
        self.assertNotEqual(ids[0], ids[1])

    def test_rejects_bad_epoch(self):
        result = run('bash', str(ROOT / 'scripts/reproducible_build.sh'), str(self.contexts[0]),
                     str(self.contexts[0] / 'Dockerfile'), self.image(), 'yesterday', str(self.dir / 'e'))
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
