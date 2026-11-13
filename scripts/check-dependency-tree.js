#!/usr/bin/env node
/**
 * Fails when the installed npm workspaces tree resolves a dependency to a version outside the
 * range its dependent declares.
 *
 * Why: with hoisting, a package installed at the root resolves its dependencies from the root, so
 * one workspace's version can silently serve another workspace's tools (it happened with semver,
 * @babel/core and parse5 for Angular, and with jsdom for vitest). `npm ci` installs whatever the
 * lockfile says without checking ranges, and `legacy-peer-deps` (needed by mobile) stops npm from
 * reporting peer conflicts. This script reads `npm ls --all --json` and fails on:
 *   - any invalid or missing regular/optional dependency;
 *   - any invalid peer dependency that is not in KNOWN_PEER_MISMATCHES below.
 *
 * Before that it checks package-lock.json itself: every installed package must carry a
 * `resolved` URL and an `integrity` hash, and the URL must be the public registry or one of the
 * vendored security patches. Without them `npm ci` downloads whatever matches the range and
 * verifies nothing. A Renovate lock file maintenance run once produced such a lockfile (PR #195,
 * 2026-11-09: 1,489 of 1,532 entries); only the three vendored packages made the tree check
 * notice it, with a misleading hint.
 *
 * Usage: node scripts/check-dependency-tree.js [--workspace <name> ...]
 *   (pass the same --workspace flags as the `npm ci` that installed the tree)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Peer edges npm cannot satisfy under legacy-peer-deps (it prunes nested peer copies as
// extraneous), keyed `<dependent>><peer>`. Each says why the mismatch is harmless; keep it short.
const KNOWN_PEER_MISMATCHES = {
  // Mobile, present before the workspaces migration: Detox's AI pilot pins Jest 29's `expect`.
  '@wix-pilot/detox>expect': 'peers on expect 27-29; the app runs Jest 30 and does not use pilot.',
  // Mobile, present before the workspaces migration: Expo's dev tunnel wants ws 8.
  '@expo/ws-tunnel>ws': 'peers on ws ^8; only used by `expo start --tunnel`.',
  // Optional peer, only loaded for istanbul instrumentation; the frontend measures coverage with
  // V8, and the hoisted 5.x copy belongs to mobile's Jest stack.
  '@angular/build>istanbul-lib-instrument': 'optional peer; frontend coverage uses V8.',
  // Optional peer of the AJV resolver; mobile only uses the zod resolver.
  '@hookform/resolvers>ajv-formats': 'optional peer of the unused AJV resolver.',
  // jest-environment-jsdom passes its own (nested) jsdom to this base class; in a mobile-only
  // install nothing else provides the peer.
  '@jest/environment-jsdom-abstract>jsdom': 'jest-environment-jsdom injects its nested jsdom.',
  // @angular/build 22.2.5 made @oxc-parser/binding-wasm32-wasi a dependency without a `cpu`
  // restriction, so it installs everywhere; its hoisted runtime cannot see the emnapi copies
  // nested under it. The WASI binding is only a fallback when no native oxc binary exists.
  '@napi-rs/wasm-runtime>@emnapi/core': 'WASI fallback of oxc-parser; native bindings are used.',
  '@napi-rs/wasm-runtime>@emnapi/runtime': 'WASI fallback of oxc-parser; native bindings are used.',
};

function readManifest(relDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** `"^6.0.0" from node_modules/@angular/build` -> [{ range, from }] */
function parseInvalid(text) {
  const result = [];
  const re = /"([^"]*)" from ([^,]+?)(?:,|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) result.push({ range: m[1], from: m[2].trim() });
  return result;
}

function edgeKind(manifest, name) {
  if (!manifest) return 'regular';
  if (manifest.dependencies?.[name] || manifest.optionalDependencies?.[name]) return 'regular';
  if (manifest.peerDependencies?.[name]) return 'peer';
  return 'regular';
}

const packageName = (relDir) => relDir.split('node_modules/').pop();

// Where a locked package may come from: the public registry (.npmrc pins it, so a mirror host
// leaking in is also an error) and the vendored patch tarballs referenced by root `overrides`.
const ALLOWED_RESOLVED = [/^https:\/\/registry\.npmjs\.org\//, /^file:mobile\/vendor\/[^/]+\.tgz$/];

/**
 * Lockfile entries `npm ci` could not install reproducibly. Workspace folders (no
 * `node_modules/` in the key), workspace links and packages bundled inside another tarball
 * (`inBundle`) legitimately have neither URL nor hash.
 */
function lockfileProblems(lock) {
  const problems = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (!key.includes('node_modules/') || entry.link || entry.inBundle) continue;
    const missing = ['resolved', 'integrity'].filter((field) => !entry[field]);
    if (missing.length > 0) problems.push(`${key}: no ${missing.join(' or ')}`);
    else if (!ALLOWED_RESOLVED.some((re) => re.test(entry.resolved))) {
      problems.push(`${key}: resolved from ${entry.resolved}`);
    }
  }
  return problems;
}

function checkLockfile() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const problems = lockfileProblems(lock);
  if (problems.length === 0) return;
  for (const line of problems.slice(0, 20)) console.error(`lockfile: ${line}`);
  if (problems.length > 20) console.error(`lockfile: ... and ${problems.length - 20} more`);
  console.error(
    `${problems.length} package-lock.json entr${problems.length === 1 ? 'y is' : 'ies are'} ` +
      'not pinned to a registry URL and integrity hash. The lockfile was regenerated wrongly: ' +
      'do not merge it; regenerate it (Renovate: tick the rebase box) and check the URLs.',
  );
  process.exit(1);
}

if (require.main !== module) {
  module.exports = { lockfileProblems };
  return;
}

checkLockfile();

const args = process.argv.slice(2);
let output;
try {
  output = execFileSync('npm', ['ls', '--all', '--json', '--long', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch (error) {
  // npm ls exits 1 when it finds problems; the JSON on stdout still describes them.
  output = error.stdout;
}
const tree = JSON.parse(output);

const failures = [];
const tolerated = [];
const seen = new Set();

function judge(dependentDir, name, line) {
  const manifest = dependentDir === '.' ? readManifest('.') : readManifest(dependentDir);
  const key = `${dependentDir === '.' ? '(root)' : packageName(dependentDir)}>${name}`;
  if (edgeKind(manifest, name) === 'peer' && KNOWN_PEER_MISMATCHES[key]) tolerated.push(line);
  else failures.push(line);
}

function walk(node) {
  const nodeDir = node.path ? path.relative(ROOT, node.path) || '.' : '.';
  for (const [name, child] of Object.entries(node.dependencies || {})) {
    if (child.invalid) {
      for (const { range, from } of parseInvalid(child.invalid)) {
        const key = `invalid|${name}|${range}|${from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        judge(from === 'the root project' ? '.' : from, name,
          `${name}@${child.version} does not satisfy "${range}" from ${from}`);
      }
    }
    if (child.missing) {
      const key = `missing|${name}|${nodeDir}`;
      if (!seen.has(key)) {
        seen.add(key);
        const manifest = readManifest(nodeDir);
        const optionalPeer = manifest?.peerDependenciesMeta?.[name]?.optional;
        if (!child.optional && !optionalPeer) judge(nodeDir, name, `${name} is missing (required by ${nodeDir})`);
      }
    }
    if (!child.deduped && !child.missing) walk(child);
  }
}
walk(tree);

for (const line of tolerated) console.log(`allowed peer mismatch: ${line}`);
if (failures.length > 0) {
  for (const line of failures) console.error(`invalid dependency: ${line}`);
  console.error(
    `${failures.length} dependency edge(s) resolve outside their declared range. A hoisted ` +
      'package is probably resolving another workspace\'s version; fix the lockfile ' +
      '(`npm install`) or pin the version the hoisted tool needs in the root package.json.',
  );
  process.exit(1);
}
console.log('Dependency tree is consistent.');
