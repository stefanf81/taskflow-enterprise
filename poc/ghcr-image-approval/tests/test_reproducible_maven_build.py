"""Reproducible application build check with REAL Maven (skipped when Maven is not usable).

Two copies of the same commit are built with examples/ci/build_and_test.sh, the second one
with CI_SKIP_TESTS=1 as the publish pipeline's comparison worker does. The declared output
must be byte-identical, which is what scripts/artifact_manifest.py + `cmp` require.

Needs `mvn`, `git` and either network access to a Maven repository or a warm ~/.m2. Extra
Maven options (for example `-s settings.xml` for a proxy) can be passed with MAVEN_ARGS.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from artifact_manifest import manifest  # noqa: E402

POM = '''<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo</groupId><artifactId>app</artifactId><version>1.0.0</version>
  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <build><finalName>app</finalName></build>
</project>
'''
JAVA = 'package demo;\npublic class App { public static void main(String[] a) { System.out.println("hi"); } }\n'
COMMIT_DATE = '2026-11-13T20:00:00+01:00'


def run(*args, **kw):
    return subprocess.run(list(args), capture_output=True, text=True, timeout=600, **kw)


@unittest.skipUnless(shutil.which('mvn') and shutil.which('git'), 'needs mvn and git')
class ReproducibleMavenBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        src = self.dir / 'src'
        (src / 'src/main/java/demo').mkdir(parents=True)
        (src / 'ci').mkdir()
        (src / 'pom.xml').write_text(POM)
        (src / 'src/main/java/demo/App.java').write_text(JAVA)
        shutil.copy(ROOT / 'examples/ci/build_and_test.sh', src / 'ci/build_and_test.sh')
        (src / 'ci/build_and_test.sh').chmod(0o755)
        env = dict(os.environ, GIT_AUTHOR_DATE=COMMIT_DATE, GIT_COMMITTER_DATE=COMMIT_DATE)
        for cmd in (['git', 'init', '-q'], ['git', 'add', '-A'],
                    ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '-q', '-m', 'c']):
            result = run(*cmd, cwd=src, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.workers = []
        for name in ('worker1', 'worker2'):
            shutil.copytree(src, self.dir / name)
            self.workers.append(self.dir / name)

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, worker, **extra_env):
        env = dict(os.environ, **extra_env)
        env.pop('BUILD_OUTPUT_TIMESTAMP', None)  # exercise the default: commit time from git
        result = run('bash', 'ci/build_and_test.sh', cwd=worker, env=env)
        output = result.stdout + result.stderr
        if result.returncode != 0 and any(s in output for s in ('could not be resolved', 'Could not transfer',
                                                                'offline mode', 'Unknown host')):
            self.skipTest('Maven cannot download plugins here (set MAVEN_ARGS for a proxy/mirror)')
        self.assertEqual(result.returncode, 0, output[-2000:])
        return manifest(worker, 'target/app.jar')

    def test_two_independent_builds_produce_identical_outputs(self):
        first = self.build(self.workers[0])
        time.sleep(2.5)  # archive timestamps have 2-second resolution
        second = self.build(self.workers[1], CI_SKIP_TESTS='1')
        self.assertEqual(first, second)
        self.assertEqual(len(first['files'][0]['sha256']), 64)


if __name__ == '__main__':
    unittest.main()
