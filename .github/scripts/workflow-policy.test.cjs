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

test("react-native-ci's two mobile path lists stay identical", () => {
  // The push trigger's `paths:` and the `changes` job's dorny/paths-filter list decide the same
  // thing for different events (a `main` push vs. a pull request). They were kept in sync by
  // hand, so an input added to one (scripts/check-dependency-tree.js was missing from both)
  // silently stops gating the other event.
  const workflow = fs.readFileSync(path.join(workflowDir, 'react-native-ci.yml'), 'utf8');
  const lines = workflow.split('\n');

  const list = (startRegex, itemIndent) => {
    const start = lines.findIndex((line) => startRegex.test(line));
    assert.notEqual(start, -1, `not found: ${startRegex}`);
    const items = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const item = lines[i].match(/^(\s*)- ['"](.+)['"]$/);
      if (!item || item[1].length !== itemIndent) break;
      items.push(item[2]);
    }
    assert.ok(items.length > 5, `only ${items.length} entries after ${startRegex}`);
    return items;
  };

  // `paths:` under the push trigger (4 spaces, double quotes) and the `mobile:` filter inside
  // the dorny `filters: |` block scalar (14 spaces, single quotes).
  assert.deepEqual(list(/^ {4}paths:$/, 6), list(/^ {12}mobile:$/, 14));
});
