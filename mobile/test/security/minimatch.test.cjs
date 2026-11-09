const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');

// Dependabot alert #89 (GHSA-g3hv-75wg-m249): globParts amplification in minimatch's
// firstPhasePreProcess() when optimizationLevel >= 2, flagged for every version < 11.0.1.
// The root overrides move minimatch 9/10 to 11.0.5. The 3.x/5.x copies that remain predate the
// globParts optimizer (no fixed 3.x/5.x release exists), and minimatch 11's CommonJS export is not
// callable, so their consumers cannot be overridden. This suite keeps that assessment true.
const repoRoot = path.resolve(__dirname, '../../..');
const PATCHED = [11, 0, 1];
const VULNERABLE_CODE = /firstPhasePreProcess|optimizationLevel/;

const isPatched = (version) => {
  const parts = version.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== PATCHED[i]) return parts[i] > PATCHED[i];
  }
  return true;
};

function findCopies(dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    if (entry.name.startsWith('@')) {
      findCopies(child, found);
      continue;
    }
    if (entry.name === 'minimatch' && fs.existsSync(path.join(child, 'package.json'))) {
      found.push(child);
    }
    findCopies(path.join(child, 'node_modules'), found);
  }
  return found;
}

function sourcesOf(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(child);
      } else if (/\.[cm]?js$/.test(entry.name)) {
        files.push(child);
      }
    }
  };
  walk(dir);
  return files;
}

const copies = findCopies(path.join(repoRoot, 'node_modules'));

test('the installed tree contains minimatch', () => {
  assert.ok(copies.length > 0, 'no minimatch copy found under the root node_modules');
});

for (const dir of copies) {
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (isPatched(version)) continue;
  const label = path.relative(repoRoot, dir);

  test(`${label}@${version} does not contain the globParts optimizer`, () => {
    const affected = sourcesOf(dir).filter((file) =>
      VULNERABLE_CODE.test(fs.readFileSync(file, 'utf8')),
    );
    assert.deepEqual(
      affected.map((file) => path.relative(repoRoot, file)),
      [],
      `minimatch ${version} ships the code from GHSA-g3hv-75wg-m249; add an override to 11.0.1+`,
    );
  });
}

// The consumers named in the alert's dependency paths still get a callable minimatch 3/5.
const consumers = [
  ['test-exclude', ['babel-plugin-istanbul']],
  ['glob', ['detox']],
  ['glob', ['bunyan', 'mv', 'rimraf']],
];

for (const [pkg, chain] of consumers) {
  test(`${[...chain, pkg].join(' > ')} resolves a callable minimatch`, () => {
    let from = repoRoot + path.sep;
    for (const step of [...chain, pkg]) {
      from = createRequire(from).resolve(`${step}/package.json`);
    }
    const minimatch = createRequire(from)('minimatch');
    assert.equal(typeof minimatch, 'function');
    assert.equal(minimatch('src/a.js', 'src/**/*.js'), true);
  });
}
