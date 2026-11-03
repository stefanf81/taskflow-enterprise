const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const script = path.resolve(__dirname, '../update-mcp.sh');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-mcp-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['bin', 'home', 'tmp', 'custom']) {
    fs.mkdirSync(path.join(dir, name));
  }
  const stub = `#!/bin/bash
set -eu
name=$(basename "$0")
echo "$name $*" >> "$FIXTURE/calls"
if [[ "$name" = go ]]; then
  case "$*" in
    'env GOBIN') echo "$FIXTURE/custom" ;;
    'install '*) cp "$FIXTURE/bin/npm" "$FIXTURE/custom/gup" ;;
  esac
  exit 0
fi
if [[ "$name" = npm && "\${HOLD:-0}" = 1 ]]; then
  (sleep 1; echo orphan > "$FIXTURE/orphan") &
  echo ready > "$FIXTURE/ready"
  wait
fi
if [[ "$name $*" = "\${FAIL_COMMAND:-none}" ]]; then
  echo 'specific failure detail' >&2
  exit 10
fi
echo "$name finished"
`;
  for (const name of ['npm', 'uv', 'go', ...(settings.customGo ? [] : ['gup'])]) {
    fs.writeFileSync(path.join(dir, 'bin', name), stub, { mode: 0o755 });
  }
  if (settings.missingNpm) {
    fs.unlinkSync(path.join(dir, 'bin/npm'));
    for (const name of ['basename', 'mkdir', 'rm', 'rmdir', 'mktemp', 'sleep', 'tail']) {
      const source = ['/usr/bin', '/bin'].map((base) => path.join(base, name))
        .find((candidate) => fs.existsSync(candidate));
      fs.symlinkSync(source, path.join(dir, 'bin', name));
    }
  }
  const env = {
    ...process.env,
    PATH: settings.missingNpm ? `${dir}/bin` : `${dir}/bin:/usr/bin:/bin`,
    HOME: `${dir}/home`,
    TMPDIR: `${dir}/tmp`,
    FIXTURE: dir,
    ...settings.env,
  };
  function run(args = []) {
    // Exercise the system Bash on macOS, not a Homebrew Bash from PATH.
    const child = spawn('/bin/bash', [script, ...args], { env });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, output }));
    });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    return { child, done };
  }
  return { dir, run, calls: () => fs.readFileSync(`${dir}/calls`, 'utf8') };
}

test('updates tools without clearing caches and removes successful logs', async (t) => {
  const f = fixture(t);
  const result = await f.run().done;
  assert.equal(result.code, 0, result.output);
  assert.match(f.calls(), /npm update -g/);
  assert.match(f.calls(), /uv tool upgrade --all/);
  assert.doesNotMatch(f.calls(), /cache/);
  assert.deepEqual(fs.readdirSync(`${f.dir}/tmp`), []);
});

test('cache failure exits nonzero, reports failing step, and retains logs', async (t) => {
  const f = fixture(t, { env: { FAIL_COMMAND: 'uv cache clean' } });
  const result = await f.run(['--clean-cache', '--verbose']).done;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /uv: FAILED \(exit 10\)/);
  assert.match(result.output, /Step: clear uv cache/);
  assert.match(result.output, /specific failure detail/);
  assert.match(result.output, /Logs retained at:/);
  assert.doesNotMatch(f.calls(), /uv cache clean --force/);
  assert.doesNotMatch(result.output, /No such file/);
});

test('failed update does not proceed to cache cleaning', async (t) => {
  const f = fixture(t, { env: { FAIL_COMMAND: 'npm update -g' } });
  const result = await f.run(['--clean-cache']).done;
  assert.equal(result.code, 1, result.output);
  assert.doesNotMatch(f.calls(), /npm cache/);
});

test('installs gup into custom GOBIN', async (t) => {
  const f = fixture(t, { customGo: true });
  const result = await f.run().done;
  assert.equal(result.code, 0, result.output);
  assert.match(f.calls(), /go install github.com\/nao1215\/gup@latest/);
  assert.match(f.calls(), /gup update/);
});

test('invalid arguments fail without creating a lock', async (t) => {
  const f = fixture(t);
  assert.equal((await f.run(['--invalid']).done).code, 2);
  assert.deepEqual(fs.readdirSync(`${f.dir}/tmp`), []);
});

test('unavailable tools are explicitly skipped rather than failed', async (t) => {
  const f = fixture(t, { missingNpm: true });
  const result = await f.run().done;
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /npm: skipped \(tool unavailable\)/);
  assert.doesNotMatch(result.output, /FAILED/);
});

test('cancellation stops descendants and concurrent invocation cannot unlock owner', async (t) => {
  const f = fixture(t, { env: { HOLD: '1' } });
  const first = f.run();
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(`${f.dir}/ready`) && Date.now() < deadline) await delay(20);
  assert.ok(fs.existsSync(`${f.dir}/ready`), 'worker started');
  const second = await f.run().done;
  assert.equal(second.code, 1, second.output);
  assert.ok(fs.readdirSync(`${f.dir}/tmp`).some((name) => name.endsWith('.lock')));
  first.child.kill('SIGTERM');
  const result = await first.done;
  assert.equal(result.code, 143, result.output);
  await delay(1200);
  assert.equal(fs.existsSync(`${f.dir}/orphan`), false);
  assert.ok(!fs.readdirSync(`${f.dir}/tmp`).some((name) => name.endsWith('.lock')));
});
