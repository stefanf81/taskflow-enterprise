// Text-level guards for the workflow rules in docs/agents/ci.md. Workflows use
// two-space indentation, so a job's own keys sit at four spaces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const workflowDir = path.join(root, 'workflows');
const workflows = fs.readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => path.join(workflowDir, name));
const actions = fs.readdirSync(path.join(root, 'actions'))
  .map((name) => path.join(root, 'actions', name, 'action.yml'))
  .filter((file) => fs.existsSync(file));

const indent = (line) => line.length - line.trimStart().length;
const rel = (file) => path.relative(path.resolve(root, '..'), file);

// The lines of the step mapping that contains line `i` (stops at the next step).
function stepBlock(lines, i) {
  const keyIndent = indent(lines[i]);
  let start = i;
  while (start > 0 && !lines[start].trimStart().startsWith('- ')) start -= 1;
  const block = [lines[start]];
  for (let j = start + 1; j < lines.length; j += 1) {
    if (lines[j].trim() !== '' && indent(lines[j]) < keyIndent) break;
    block.push(lines[j]);
  }
  return block;
}

test('setup-node never caches npm itself', () => {
  // The npm-ci action (cache-node-modules) or explicit actions/cache steps own
  // ~/.npm. Without `package-manager-cache: false` setup-node enables npm
  // caching from the root `packageManager` field, and a job that never runs
  // `npm ci` saves an empty ~/.npm that later exact hits never replace.
  const offenders = [];
  for (const file of [...workflows, ...actions]) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/^\s*(- )?uses: actions\/setup-node@/.test(line)) return;
      const block = stepBlock(lines, i);
      const disabled = block.some((l) => /^\s*package-manager-cache:\s*false\s*$/.test(l));
      const cached = block.some((l) => /^\s*cache(-dependency-path)?:/.test(l));
      if (!disabled || cached) offenders.push(`${rel(file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'set `package-manager-cache: false` and drop `cache:`');
});

test('job conditions use !cancelled(), never always()', () => {
  const offenders = [];
  for (const file of workflows) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/^ {4}if:/.test(line)) return;
      let condition = line.replace(/^ {4}if:\s*/, '');
      if (/^[|>][-+]?$/.test(condition)) {
        const body = [];
        for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indent(lines[j]) > 4); j += 1) {
          body.push(lines[j]);
        }
        condition = body.join('\n');
      }
      if (condition.includes('always()')) offenders.push(`${rel(file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('the BuildKit image is pinned to a version and index digest', () => {
  const action = fs.readFileSync(path.join(root, 'actions', 'prepull-buildkit', 'action.yml'), 'utf8');
  const marker = '# buildkit-image: tracked by the dedicated regex manager in .github/renovate.json';
  assert.match(action, new RegExp(
    `${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\s+default: "moby/buildkit:v\\d+\\.\\d+\\.\\d+@sha256:[a-f0-9]{64}"`,
  ));
});

test('the DAST API scan sends its token and proves it', () => {
  const dast = fs.readFileSync(path.join(workflowDir, 'dast.yml'), 'utf8');
  // ZAP adds the auth header when the request's host name contains this value. A URL never
  // matches, and the scan then runs unauthenticated without any error (BENCHMARKS.md §69).
  const sites = [...dast.matchAll(/^\s*ZAP_AUTH_HEADER_SITE:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  assert.notDeepEqual(sites, []);
  for (const site of sites) {
    assert.doesNotMatch(site, /[:/]/, 'ZAP_AUTH_HEADER_SITE is a host-name substring, not a URL');
  }

  const api = dast.slice(dast.indexOf('\n  dast-api:'), dast.indexOf('\n  dast-web:'));
  assert.match(api, /^\s+uses: \.\/\.github\/actions\/zap-report$/m);
  assert.match(api, /^\s+require-success: \/api\/v1\/\S+$/m);
  assert.match(api, /^\s+token: \$\{\{ steps\.auth\.outputs\.token \}\}$/m);
});

test('package cleanup protects deployed digests, rollback tags and default commit-SHA releases', () => {
  const cleanup = fs.readFileSync(path.join(workflowDir, 'cleanup-packages.yml'), 'utf8');
  assert.match(cleanup, /protected_refs:/);
  assert.match(cleanup, /rollback\|prod\|production\|deployed/);
  assert.match(cleanup, /\[0-9a-f\]\{40\}/);
  assert.doesNotMatch(cleanup, /2>\/dev\/null\s*\|\s*jq/, 'only HTTP 404 may skip; API failures must fail');
});
