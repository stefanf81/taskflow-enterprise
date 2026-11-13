const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');

const { lockfileProblems } = require('./check-dependency-tree.js');

const ROOT = path.resolve(__dirname, '..');
const registry = (name, version) => ({
  version,
  resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
  integrity: 'sha512-AAAA',
});
const lock = (packages) => ({ lockfileVersion: 3, packages: { '': { name: 'root' }, ...packages } });

test('the committed lockfile is fully pinned', () => {
  assert.deepEqual(lockfileProblems(require(path.join(ROOT, 'package-lock.json'))), []);
});

test('accepts registry packages, vendored patches, workspaces, links and bundled packages', () => {
  const problems = lockfileProblems(
    lock({
      mobile: { version: '1.0.0' },
      'node_modules/taskflow-mobile': { resolved: 'mobile', link: true },
      'node_modules/fill-range': registry('fill-range', '7.1.1'),
      'node_modules/braces': {
        version: '3.0.3',
        resolved: 'file:mobile/vendor/braces-3.0.3-patched.tgz',
        integrity: 'sha512-BBBB',
      },
      'node_modules/a/node_modules/tslib': { version: '2.8.1', inBundle: true },
    }),
  );
  assert.deepEqual(problems, []);
});

test('flags entries without resolved or integrity (the 2026-11-09 Renovate lockfile)', () => {
  const problems = lockfileProblems(
    lock({
      'node_modules/braces': { version: '3.0.3', dependencies: { 'fill-range': '^7.1.1' } },
      'node_modules/deepmerge': { version: '4.3.1', resolved: 'file:mobile/vendor/x.tgz' },
    }),
  );
  assert.deepEqual(problems, [
    'node_modules/braces: no resolved or integrity',
    'node_modules/deepmerge: no integrity',
  ]);
});

test('flags URLs outside the public registry and the vendored patches', () => {
  const mirror = registry('zod', '4.6.7');
  mirror.resolved = mirror.resolved.replace('registry.npmjs.org', 'nexus.corp.example/repository/npm');
  const outside = { ...registry('x', '1.0.0'), resolved: 'file:../elsewhere/x-1.0.0.tgz' };
  const problems = lockfileProblems(lock({ 'node_modules/zod': mirror, 'node_modules/x': outside }));
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^node_modules\/zod: resolved from https:\/\/nexus\.corp\.example\//);
  assert.match(problems[1], /^node_modules\/x: resolved from file:\.\.\/elsewhere\//);
});

test('requiring the script does not run npm ls', () => {
  const out = execFileSync(process.execPath, ['-e', "require('./scripts/check-dependency-tree.js')"], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(out, '');
});
