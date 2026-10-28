const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { preflight, collectDiagnostics } = require('./mobile-e2e-backend.cjs');

const token = 'TEST-BEARER-MUST-NOT-APPEAR-IN-LOGS';
const session = {
  accessToken: token, tokenType: 'Bearer', expiresIn: 3600, username: 'admin', role: 'ROLE_ADMIN',
};

async function backend(t, override = () => false) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, route: req.url, authorization: req.headers.authorization, body });
    if (override(req, res)) return;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/mobile/login') res.end(JSON.stringify(session));
    else if (req.url === '/api/v1/auth/me') res.end(JSON.stringify({ username: 'admin', role: 'ROLE_ADMIN' }));
    else { res.statusCode = 204; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

test('preflight checks the real admin bearer flow and revokes only its own token', async (t) => {
  const fixture = await backend(t);
  const messages = [];
  await preflight({ baseUrl: fixture.baseUrl, log: (message) => messages.push(message) });
  assert.deepEqual(fixture.requests.map(({ method, route }) => `${method} ${route}`), [
    'POST /api/v1/auth/mobile/login', 'GET /api/v1/auth/me', 'POST /api/v1/auth/logout',
  ]);
  assert.deepEqual(JSON.parse(fixture.requests[0].body), { username: 'admin', password: 'admin-password' });
  assert.equal(fixture.requests[0].authorization, undefined);
  assert.equal(fixture.requests[1].authorization, `Bearer ${token}`);
  assert.equal(fixture.requests[2].authorization, `Bearer ${token}`);
  assert.match(messages.join('\n'), /authentication preflight passed/);
  assert.doesNotMatch(messages.join('\n'), /TEST-BEARER|admin-password|Authorization|accessToken/);
});

test('bad credentials fail immediately without retrying or echoing the response', async (t) => {
  const fixture = await backend(t, (req, res) => {
    res.statusCode = 401;
    res.end(`sensitive response ${token}`);
    return true;
  });
  const messages = [];
  await assert.rejects(preflight({ baseUrl: fixture.baseUrl, log: (message) => messages.push(message) }),
    /POST \/api\/v1\/auth\/mobile\/login failed \(HTTP 401\)/);
  assert.equal(fixture.requests.length, 1);
  assert.doesNotMatch(messages.join('\n'), /sensitive|TEST-BEARER/);
});

test('a rejected /me still cleans up the preflight token', async (t) => {
  const fixture = await backend(t, (req, res) => {
    if (req.url !== '/api/v1/auth/me') return false;
    res.statusCode = 403;
    res.end('do not print this body');
    return true;
  });
  await assert.rejects(preflight({ baseUrl: fixture.baseUrl, log: () => {} }), /auth\/me failed \(HTTP 403\)/);
  assert.equal(fixture.requests.at(-1).route, '/api/v1/auth/logout');
});

test('a non-admin response is refused even when both HTTP calls succeed', async (t) => {
  const fixture = await backend(t, (req, res) => {
    if (req.url !== '/api/v1/auth/me') return false;
    res.end(JSON.stringify({ username: 'admin', role: 'ROLE_CUSTOMER' }));
    return true;
  });
  await assert.rejects(preflight({ baseUrl: fixture.baseUrl, log: () => {} }), /restore the admin identity/);
  assert.equal(fixture.requests.at(-1).route, '/api/v1/auth/logout');
});

test('a login payload without an admin session fails before /me and still revokes its token', async (t) => {
  const fixture = await backend(t, (req, res) => {
    if (req.url !== '/api/v1/auth/mobile/login') return false;
    res.end(JSON.stringify({ ...session, role: 'ROLE_CUSTOMER' }));
    return true;
  });
  await assert.rejects(preflight({ baseUrl: fixture.baseUrl, log: () => {} }), /valid admin bearer session/);
  assert.deepEqual(fixture.requests.map(request => request.route), [
    '/api/v1/auth/mobile/login', '/api/v1/auth/logout',
  ]);
});

test('malformed JSON cannot leak the returned token through a parse error', async (t) => {
  const fixture = await backend(t, (req, res) => { res.end(`invalid-json-${token}`); return true; });
  await assert.rejects(preflight({ baseUrl: fixture.baseUrl, log: () => {} }), (error) => {
    assert.match(error.message, /failed \(HTTP 200\)/);
    assert.doesNotMatch(error.message, /TEST-BEARER|invalid-json/);
    return true;
  });
});

for (const sendHeaders of [false, true]) {
  test(`a stalled ${sendHeaders ? 'body' : 'response'} fails without retrying or increasing the deadline`, async (t) => {
    const fixture = await backend(t, (req, res) => {
      if (sendHeaders) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{');
      }
      return true;
    });
    const started = performance.now();
    await assert.rejects(preflight({ baseUrl: fixture.baseUrl, timeoutMs: 100, log: () => {} }),
      /timed out after 100ms/);
    assert.ok(performance.now() - started < 2000, 'a stalled request must not hang CI');
    assert.equal(fixture.requests.length, 1);
  });
}

test('the preflight will not send dev credentials to a remote host or follow redirects', async (t) => {
  await assert.rejects(preflight({ baseUrl: 'https://example.com' }), /local HTTP origin/);
  const fixture = await backend(t, (req, res) => {
    res.writeHead(302, { Location: 'https://example.com' });
    res.end();
    return true;
  });
  await assert.rejects(preflight({ baseUrl: fixture.baseUrl, log: () => {} }), /failed/);
  assert.equal(fixture.requests.length, 1);
});

async function diagnosticDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-e2e-diagnostics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('diagnostics use the backend JDK, include virtual threads and bound every command', async (t) => {
  const directory = await diagnosticDirectory(t);
  const commands = [];
  await collectDiagnostics({
    directory, pid: '42', javaHome: '/backend-jdk-25', log: () => {},
    run: async (command, args, options) => {
      commands.push({ command, args, options });
      if (args.includes('Thread.dump_to_file')) await fs.writeFile(args.at(-1), '{"threads":[]}');
      return { stdout: 'diagnostic output', stderr: '' };
    },
    probe: async ({ log }) => log('host authentication passed'),
  });
  assert.equal(commands[0].command, 'ps');
  assert.deepEqual(commands[0].args, ['-p', '42', '-o', 'pid,ppid,etime,%cpu,%mem,stat']);
  assert.equal(commands[1].command, '/backend-jdk-25/bin/jcmd');
  assert.deepEqual(commands[1].args, ['42', 'Thread.print', '-l']);
  assert.ok(commands[2].args.includes('Thread.dump_to_file'));
  for (const command of commands) assert.equal(command.options.timeout, 10_000);
  assert.equal(await fs.readFile(path.join(directory, 'virtual-threads.json'), 'utf8'), '{"threads":[]}');
  assert.match(await fs.readFile(path.join(directory, 'diagnostics.log'), 'utf8'), /host authentication passed/);
});

test('failed attach commands do not skip the remaining diagnostics or mask the original failure', async (t) => {
  const directory = await diagnosticDirectory(t);
  let commands = 0;
  let probes = 0;
  await collectDiagnostics({
    directory, pid: '42', log: () => {},
    run: async () => { commands++; throw Object.assign(new Error('attach timed out'), { stderr: 'not running' }); },
    probe: async () => { probes++; throw new Error('Login probe failed (HTTP none).'); },
  });
  assert.equal(commands, 3);
  assert.equal(probes, 1);
  assert.match(await fs.readFile(path.join(directory, 'threads.txt'), 'utf8'), /exceeded 10000ms/);
  assert.match(await fs.readFile(path.join(directory, 'diagnostics.log'), 'utf8'), /Login probe failed/);
});

test('a missing or invalid backend PID never attaches to an unrelated process', async (t) => {
  for (const pid of [undefined, '', '0', '42; echo unsafe']) {
    await collectDiagnostics({
      directory: await diagnosticDirectory(t), pid, log: () => {},
      run: async () => assert.fail('must not execute a process command'),
      probe: async () => {},
    });
  }
});

test('both Detox jobs enable safe access logs, require preflight and preserve failure diagnostics', async () => {
  const workflow = await fs.readFile(path.join(__dirname, '../workflows/react-native-ci.yml'), 'utf8');
  const android = workflow.split('  android-e2e:')[1].split('  ios-e2e:')[0];
  const ios = workflow.split('  ios-e2e:')[1];
  assert.match(android, /env: &e2e-backend-access-log/);
  assert.match(android, /SERVER_TOMCAT_ACCESSLOG_PATTERN: "%t %m %U %s %D"/);
  assert.match(android, /SERVER_TOMCAT_ACCESSLOG_BUFFERED: "false"/);
  assert.match(ios, /env: \*e2e-backend-access-log/);
  assert.match(android, /&mobile-backend-preflight/);
  assert.match(ios, /\*mobile-backend-preflight/);
  assert.match(android, /&mobile-backend-diagnostics/);
  assert.match(ios, /\*mobile-backend-diagnostics/);
  for (const job of [android, ios]) assert.match(job, /            e2e-backend-diagnostics\//);
  assert.match(android, /if: failure\(\) && steps.backend.outputs.pid != ''/);
});
