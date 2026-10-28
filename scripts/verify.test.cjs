const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['bin', 'scripts', 'node_modules']) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  }
  fs.copyFileSync(path.join(root, 'verify.sh'), path.join(dir, 'verify.sh'));
  fs.copyFileSync(
    path.join(root, 'scripts/check-verification-ports.cjs'),
    path.join(dir, 'scripts/check-verification-ports.cjs'),
  );
  fs.writeFileSync(path.join(dir, '.env'), '');
  fs.writeFileSync(path.join(dir, 'source.txt'), 'unformatted source stays unchanged\n');
  const stub = String.raw`#!/usr/bin/env bash
set -eu
name="$(basename "$0")"
echo "$name $*" >> "$FIXTURE/calls"
case "$name" in
  docker)
    case "$*" in
      'compose ps --all --quiet') [ "$EXISTING" = 0 ] || echo existing ;;
      'compose config --format json') printf '%s\n' "$PORT_CONFIG" ;;
      'context inspect --format {{.Endpoints.docker.Host}}') printf '%s\n' "$DOCKER_ENDPOINT" ;;
    esac ;;
  uname) printf '%s\n' "$PLATFORM" ;;
  gradlew) (printenv TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE || echo unset) >> "$FIXTURE/socket-overrides" ;;
  npm)
    if [ "$*" = '--prefix frontend run e2e' ]; then
      [ "$E2E_DOCKER" = true ] && [ "$PLAYWRIGHT_HTML_OPEN" = never ] || exit 10
    fi
    if [ "$*" = 'run lint:all' ]; then
      if [ "$HOLD" = 1 ]; then
        (sleep 2; echo orphan > "$FIXTURE/orphan") &
        echo ready > "$FIXTURE/ready"
        wait
      fi
      [ "$FAIL_LINT" = 0 ] || exit 7
    fi ;;
  start-docker.sh)
    if [ "$HOLD_START" = 1 ]; then
      (sleep 2; echo orphan > "$FIXTURE/orphan") &
      echo ready > "$FIXTURE/ready"
      wait
    fi
    [ "$FAIL_START" = 0 ] || exit 8 ;;
  stop-docker.sh) [ "$FAIL_STOP" = 0 ] || exit 9 ;;
  curl) [ "$FAIL_READY" = 0 ] || exit 22 ;;
esac
`;
  for (const name of [
    'npm',
    'java',
    'docker',
    'uname',
    'curl',
    'psql',
    'gradlew',
    'start-docker.sh',
    'stop-docker.sh',
  ]) {
    fs.writeFileSync(
      path.join(
        dir,
        ['gradlew', 'start-docker.sh', 'stop-docker.sh'].includes(name) ? name : `bin/${name}`,
      ),
      stub,
      { mode: 0o755 },
    );
  }
  const env = {
    ...process.env,
    PATH: `${dir}/bin:${process.env.PATH}`,
    TMPDIR: dir,
    FIXTURE: dir,
    NO_COLOR: '1',
    VERIFY_READY_TIMEOUT_SECONDS: '1',
    EXISTING: '0',
    HOLD: '0',
    HOLD_START: '0',
    FAIL_LINT: '0',
    FAIL_START: '0',
    FAIL_STOP: '0',
    FAIL_READY: '0',
    PORT_CONFIG: '{"services":{}}',
    PLATFORM: 'Linux',
    DOCKER_ENDPOINT: 'unix:///var/run/docker.sock',
    DOCKER_HOST: '',
    ...settings,
  };
  if (!Object.hasOwn(settings, 'TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE')) {
    delete env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE;
  }
  function start(args = []) {
    const child = spawn(path.join(dir, 'verify.sh'), args, {
      cwd: path.dirname(dir),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const done = once(child, 'close').then(([code, signal]) => ({
      code,
      signal,
      output,
    }));
    return { child, done };
  }
  return {
    dir,
    start,
    calls: () =>
      fs.existsSync(path.join(dir, 'calls'))
        ? fs.readFileSync(path.join(dir, 'calls'), 'utf8')
        : '',
  };
}

test('help and unknown arguments do not run checks', async (t) => {
  const f = fixture(t);
  assert.equal((await f.start(['--help']).done).code, 0);
  assert.equal((await f.start(['--typo']).done).code, 2);
  assert.equal(f.calls(), '');
});

test('quick mode anchors cwd and runs noninteractive coverage without Docker', async (t) => {
  const f = fixture(t);
  const result = await f.start(['--quick']).done;
  assert.equal(result.code, 0, result.output);
  assert.match(f.calls(), /npm --prefix frontend test -- --watch=false --coverage/);
  assert.match(f.calls(), /npm --prefix mobile test -- --ci --coverage --maxWorkers=50%/);
  assert.match(f.calls(), /gradlew check/);
  assert.doesNotMatch(f.calls(), /docker|curl|testcontainersTest|e2e|--write/);
  assert.match(result.output, /SKIPPED \(--quick\)/);
});

test('format/lint failure fails without fixing files or running later checks', async (t) => {
  const f = fixture(t, { FAIL_LINT: '1' });
  const before = fs.readFileSync(path.join(f.dir, 'source.txt'), 'utf8');
  assert.equal((await f.start(['--quick']).done).code, 7);
  assert.equal(fs.readFileSync(path.join(f.dir, 'source.txt'), 'utf8'), before);
  assert.equal(f.calls(), 'npm run lint:all\n');
});

test('existing containers are rejected even with compatibility flag', async (t) => {
  const f = fixture(t, { EXISTING: '1' });
  const result = await f.start(['--stop-docker']).done;
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Existing Compose containers/);
  assert.doesNotMatch(f.calls(), /npm|start-docker|stop-docker/);
});

test('a real occupied Compose port is rejected before checks', async (t) => {
  const server = net.createServer((socket) => socket.end());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const f = fixture(t, {
    PORT_CONFIG: JSON.stringify({
      services: {
        web: { ports: [{ published: String(port), protocol: 'tcp' }] },
      },
    }),
  });
  const result = await f.start().done;
  assert.notEqual(result.code, 0);
  assert.match(result.output, new RegExp(`Occupied Compose ports: ${port}`));
  assert.doesNotMatch(f.calls(), /npm|start-docker|stop-docker/);
});

test('full mode runs PostgreSQL then fresh build and E2E, cleaning once', async (t) => {
  const f = fixture(t);
  const result = await f.start().done;
  assert.equal(result.code, 0, result.output);
  assert.match(
    f.calls(),
    /gradlew testcontainersTest[\s\S]*start-docker.sh[\s\S]*npm --prefix frontend run e2e/,
  );
  assert.equal(f.calls().match(/^stop-docker.sh/gm)?.length, 1);
  assert.equal(fs.readFileSync(path.join(f.dir, 'socket-overrides'), 'utf8'), 'unset\nunset\n');
});

test('partial startup failure prints diagnostics and cleans exactly once', async (t) => {
  const f = fixture(t, { FAIL_START: '1' });
  const result = await f.start().done;
  assert.equal(result.code, 8, result.output);
  assert.match(f.calls(), /docker compose logs --no-color --tail 80/);
  assert.equal(f.calls().match(/^stop-docker.sh/gm)?.length, 1);
  assert.doesNotMatch(f.calls(), /npm --prefix frontend run e2e/);
});

test('Rancher Desktop uses its VM socket only for full-mode Testcontainers', async (t) => {
  const f = fixture(t, {
    PLATFORM: 'Darwin',
    DOCKER_ENDPOINT: 'unix:///Users/test/.rd/docker.sock',
  });
  const result = await f.start().done;
  assert.equal(result.code, 0, result.output);
  assert.equal(
    fs.readFileSync(path.join(f.dir, 'socket-overrides'), 'utf8'),
    'unset\n/var/run/docker.sock\n',
  );
});

test('an explicit Testcontainers socket override is preserved', async (t) => {
  const f = fixture(t, {
    PLATFORM: 'Darwin',
    DOCKER_ENDPOINT: 'unix:///Users/test/.rd/docker.sock',
    TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: '/custom/docker.sock',
  });
  const result = await f.start().done;
  assert.equal(result.code, 0, result.output);
  assert.equal(
    fs.readFileSync(path.join(f.dir, 'socket-overrides'), 'utf8'),
    '/custom/docker.sock\n/custom/docker.sock\n',
  );
});

test('cleanup failure turns success into failure', async (t) => {
  const f = fixture(t, { FAIL_STOP: '1' });
  const result = await f.start().done;
  assert.equal(result.code, 1);
  assert.match(result.output, /Container cleanup failed/);
  assert.doesNotMatch(result.output, /Requested checks passed/);
});

test('readiness failure is bounded and never runs E2E', async (t) => {
  const f = fixture(t, { FAIL_READY: '1' });
  const result = await f.start().done;
  assert.notEqual(result.code, 0);
  assert.match(result.output, /did not become ready/);
  assert.doesNotMatch(f.calls(), /npm --prefix frontend run e2e/);
  assert.equal(f.calls().match(/^stop-docker.sh/gm)?.length, 1);
});

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  test(`${signal} interrupts a child and its descendants without continuing`, async (t) => {
    const f = fixture(t, { HOLD: '1' });
    const { child, done } = f.start(['--quick']);
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGTERM');
    });
    for (let attempt = 0; !fs.existsSync(path.join(f.dir, 'ready')); attempt++) {
      assert.ok(attempt < 200, 'child did not become ready');
      await delay(10);
    }
    child.kill(signal);
    const result = await done;
    assert.equal(result.code, code, result.output);
    assert.equal(f.calls(), 'npm run lint:all\n');
    await delay(2100);
    assert.equal(fs.existsSync(path.join(f.dir, 'orphan')), false);
  });

  test(`${signal} during partial startup cleans owned containers once`, async (t) => {
    const f = fixture(t, { HOLD_START: '1', FAIL_STOP: '1' });
    const { child, done } = f.start();
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGTERM');
    });
    for (let attempt = 0; !fs.existsSync(path.join(f.dir, 'ready')); attempt++) {
      assert.ok(attempt < 300, 'startup did not become ready');
      await delay(10);
    }
    child.kill(signal);
    const result = await done;
    assert.equal(result.code, code, result.output);
    assert.equal(f.calls().match(/^stop-docker.sh/gm)?.length, 1);
    assert.doesNotMatch(f.calls(), /npm --prefix frontend run e2e/);
    await delay(2100);
    assert.equal(fs.existsSync(path.join(f.dir, 'orphan')), false);
  });
}

test('verification lock rejects a second run and is released on interruption', async (t) => {
  const f = fixture(t, { HOLD: '1' });
  const first = f.start(['--quick']);
  t.after(() => {
    if (first.child.exitCode === null) first.child.kill('SIGTERM');
  });
  for (let attempt = 0; !fs.existsSync(path.join(f.dir, 'ready')); attempt++) {
    assert.ok(attempt < 200);
    await delay(10);
  }
  const second = await f.start(['--quick']).done;
  assert.equal(second.code, 1);
  assert.match(second.output, /Another verification may be running/);
  first.child.kill('SIGTERM');
  assert.equal((await first.done).code, 143);
  assert.equal(
    fs.readdirSync(f.dir).some((name) => name.endsWith('.lock')),
    false,
  );
});

test('workflows never use npm --prefix exec, which keeps the root working directory', () => {
  const workflows = path.join(root, '.github/workflows');
  for (const name of fs.readdirSync(workflows).filter((file) => file.endsWith('.yml'))) {
    const content = fs.readFileSync(path.join(workflows, name), 'utf8');
    assert.doesNotMatch(content, /npm\s+--prefix\s+\S+\s+exec\b/, name);
  }
  const dast = fs.readFileSync(path.join(workflows, 'dast.yml'), 'utf8');
  assert.match(dast, /npm --workspace frontend exec -- ng build/);
});
