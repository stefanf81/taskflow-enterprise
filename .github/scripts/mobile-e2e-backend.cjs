#!/usr/bin/env node
// CI-only probes: never log credentials, bearer tokens, response bodies or request headers.
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execute = promisify(execFile);

// The logged status is copied from this fixed table, so nothing the server sends is written to the
// diagnostics files (CodeQL js/http-to-file-access); a status outside 100-599 is logged as "invalid".
const HTTP_STATUS_CODES = Array.from({ length: 500 }, (_, index) => index + 100);
const loggedStatus = (status) => HTTP_STATUS_CODES.find((code) => code === status) ?? 'invalid';

async function preflight({
  baseUrl = 'http://localhost:8080',
  timeoutMs = 10_000,
  log = console.log,
} = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
      || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('The mobile E2E backend must be a local HTTP origin.');
  }

  async function request(method, route, { token, body, status = 200 } = {}) {
    const started = performance.now();
    const signal = AbortSignal.timeout(timeoutMs);
    let receivedStatus = 'none';
    try {
      const response = await fetch(new URL(route, base), {
        method,
        redirect: 'error',
        signal,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      receivedStatus = loggedStatus(response.status);
      if (response.status !== status) {
        await response.body?.cancel();
        throw new Error('Unexpected HTTP status');
      }
      return status === 204 ? null : await response.json();
    } catch {
      const reason = signal.aborted ? `timed out after ${timeoutMs}ms` : 'failed';
      throw new Error(`${method} ${route} ${reason} (HTTP ${receivedStatus}).`);
    } finally {
      log(`${method} ${route}: HTTP ${receivedStatus}, ${Math.round(performance.now() - started)}ms`);
    }
  }

  const login = await request('POST', '/api/v1/auth/mobile/login', {
    body: { username: 'admin', password: 'admin-password' },
  });
  const token = typeof login?.accessToken === 'string' ? login.accessToken : '';
  let failure;
  try {
    if (!token || login.tokenType !== 'Bearer' || login.username !== 'admin'
        || login.role !== 'ROLE_ADMIN' || !Number.isSafeInteger(login.expiresIn) || login.expiresIn <= 0) {
      throw new Error('Mobile login did not return a valid admin bearer session.');
    }
    const me = await request('GET', '/api/v1/auth/me', { token });
    if (me?.username !== 'admin' || me?.role !== 'ROLE_ADMIN') {
      throw new Error('The mobile bearer token did not restore the admin identity.');
    }
  } catch (error) {
    failure = error;
  }
  // Do not leave a preflight token live, even if /me or the response validation failed.
  if (token) {
    try {
      await request('POST', '/api/v1/auth/logout', { token, status: 204 });
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  log('Mobile backend authentication preflight passed.');
}

async function collectDiagnostics({
  pid,
  javaHome = process.env.JAVA_HOME,
  directory = path.resolve('e2e-backend-diagnostics'),
  baseUrl,
  run = execute,
  probe = preflight,
  log = console.log,
} = {}) {
  await fs.mkdir(directory, { recursive: true });
  const record = async (message) => {
    log(message);
    await fs.appendFile(path.join(directory, 'diagnostics.log'), `${message}\n`);
  };
  await record(`Backend diagnostics captured at ${new Date().toISOString()}`);

  async function capture(file, command, args) {
    let output;
    try {
      const result = await run(command, args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
      output = `${result.stdout || ''}${result.stderr || ''}`;
    } catch (error) {
      // An exited JVM or unavailable attach tool must not hide the Detox failure or skip probes.
      output = `Diagnostic command failed or exceeded 10000ms.\n${error.stdout || ''}${error.stderr || ''}`;
    }
    await fs.writeFile(path.join(directory, file), output);
  }

  if (/^[1-9]\d*$/.test(String(pid))) {
    const jcmd = javaHome ? path.join(javaHome, 'bin/jcmd') : 'jcmd';
    await capture('process.txt', 'ps', ['-p', String(pid), '-o', 'pid,ppid,etime,%cpu,%mem,stat']);
    // Thread.print supplies lock information; dump_to_file includes Java 25's virtual threads.
    await capture('threads.txt', jcmd, [String(pid), 'Thread.print', '-l']);
    await capture('virtual-threads-command.txt', jcmd, [
      String(pid), 'Thread.dump_to_file', '-format=json', path.resolve(directory, 'virtual-threads.json'),
    ]);
  } else {
    await record('Backend PID unavailable; skipping process and thread dumps.');
  }

  const messages = [];
  try {
    // A second real login distinguishes a persistent backend failure from the earlier UI timeout.
    // Each HTTP operation still has the app's 10-second ceiling, with no retry or timeout increase.
    await probe({ baseUrl, log: (message) => messages.push(message) });
  } catch (error) {
    messages.push(error.message);
  }
  for (const message of messages) await record(message);
}

async function main(mode = process.argv[2]) {
  if (!['preflight', 'diagnostics'].includes(mode)) {
    throw new Error('Usage: mobile-e2e-backend.cjs <preflight|diagnostics>');
  }
  const directory = path.resolve('e2e-backend-diagnostics');
  if (mode === 'diagnostics') {
    await collectDiagnostics({ pid: process.env.BACKEND_PID,
      javaHome: process.env.BACKEND_JAVA_HOME || process.env.JAVA_HOME, directory });
    return;
  }
  await fs.mkdir(directory, { recursive: true });
  const messages = [];
  try {
    await preflight({ log: (message) => { console.log(message); messages.push(message); } });
  } catch (error) {
    messages.push(error.message);
    throw error;
  } finally {
    await fs.writeFile(path.join(directory, 'preflight.log'), `${messages.join('\n')}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { preflight, collectDiagnostics };
