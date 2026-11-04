const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join, relative } = require('node:path');
const { test } = require('node:test');

// Expo CLI 58 still declares Zod 3. Keep its scoped override on the app's
// patched Zod for as long as that declaration installs a copy.
const cliPackageJson = require.resolve('@expo/cli/package.json');
const cliRequire = createRequire(cliPackageJson);

test('Expo CLI resolves the same patched Zod as the app', () => {
  assert.equal(cliRequire.resolve('zod'), require.resolve('zod'));
  // One lockfile at the repository root since the npm workspaces migration.
  const lock = require('../../../package-lock.json');
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path.endsWith('node_modules/zod')) continue;
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    assert.ok(
      major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))),
      `${path} contains vulnerable Zod ${pkg.version}`,
    );
  }
});

// Up to @expo/cli 58.1.18 the DevTools plugin schemas were Zod 3 schemas running on
// the overridden Zod 4, and this file exercised them. Since 58.1.19 they are plain
// JSON Schema objects and the CLI no longer loads Zod. If a release imports Zod
// again, restore those behaviour tests from git history before taking it.
test('Expo CLI does not load Zod at runtime', () => {
  const buildDir = join(dirname(cliPackageJson), 'build');
  const zodImport = /\brequire\(\s*["']zod(?:\/[^"']*)?["']\s*\)|\bimport\(\s*["']zod(?:\/[^"']*)?["']\s*\)|\bfrom\s*["']zod(?:\/[^"']*)?["']/;
  const offenders = [];
  let scanned = 0;
  for (const entry of readdirSync(buildDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.[cm]?js$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    scanned++;
    if (zodImport.test(readFileSync(file, 'utf8'))) offenders.push(relative(buildDir, file));
  }
  assert.ok(scanned > 100, `only ${scanned} files under ${buildDir}; has the CLI layout changed?`);
  assert.deepEqual(offenders, [], 'Expo CLI imports Zod again; restore its behaviour tests');
});
