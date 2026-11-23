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

// The lines of one job: from its key to the next job key (or the end of the file).
function jobBlock(workflow, name) {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `job not found: ${name}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z_][\w-]*:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

test('published images are signed, attested and verified before they are promoted', () => {
  // A final tag must never point at an unsigned digest: once the cluster verifies signatures,
  // an image promoted before a failed signing step could not be deployed.
  const workflow = fs.readFileSync(path.join(workflowDir, 'pushdockerimage.yml'), 'utf8');
  const job = jobBlock(workflow, 'promote');
  // Only the `steps:` list: `needs:` items sit at the same indentation.
  const promote = job.slice(job.indexOf('    steps:') + 1);
  assert.notEqual(job.indexOf('    steps:'), -1);
  const stepStarts = promote.flatMap((line, i) => (/^ {6}- /.test(line) ? [i] : []));
  const steps = stepStarts.map((start, n) => promote.slice(start, stepStarts[n + 1] ?? promote.length));
  const names = steps.map((step) => (step[0].match(/^ {6}- name: (.+)$/) ?? [])[1]);

  const order = [
    'Sign Image',
    'Attest Build Provenance',
    'Verify Signature and Attestation',
    'Promote Image to Final Tags',
  ];
  const positions = order.map((name) => names.indexOf(name));
  assert.ok(!positions.includes(-1), `promote needs the steps ${order.join(', ')}`);
  assert.deepEqual(positions, [...positions].sort((x, y) => x - y), 'sign, attest, verify, then promote');

  // A skipped or tolerated signing step would promote an unsigned digest.
  for (const position of positions) {
    const step = steps[position].join('\n');
    assert.doesNotMatch(step, /^ {8}(if|continue-on-error):/m, `${names[position]} must not be conditional`);
  }

  const body = (name) => steps[names.indexOf(name)].join('\n');
  assert.match(body('Sign Image'), /cosign sign --yes .*-a "scan=\$\{SCAN\}" "\$\{IMAGE\}@\$\{DIGEST\}"/);
  assert.match(body('Attest Build Provenance'), /^ {8}uses: actions\/attest@/m);
  assert.ok(body('Verify Signature and Attestation').includes('cosign verify "${IMAGE}@${DIGEST}"'));
  assert.ok(body('Verify Signature and Attestation').includes('gh attestation verify "oci://${IMAGE}@${DIGEST}"'));

  // The scan report is checked before anything is signed, attested after the provenance and
  // verified with it. Only skip_scan may skip these steps: the cluster requires the attestation.
  const scanSteps = ['Download Scan Report', 'Check Scan Report', 'Attest Scan Report'];
  const scanPositions = scanSteps.map((name) => names.indexOf(name));
  assert.ok(!scanPositions.includes(-1), `promote needs the steps ${scanSteps.join(', ')}`);
  assert.ok(scanPositions[1] < names.indexOf('Sign Image'), 'check the scan report before signing');
  assert.ok(names.indexOf('Attest Build Provenance') < scanPositions[2]);
  assert.ok(scanPositions[2] < names.indexOf('Verify Signature and Attestation'));
  for (const name of scanSteps) {
    assert.deepEqual(
      steps[names.indexOf(name)].filter((line) => /^ {8}(if|continue-on-error):/.test(line)),
      ['        if: ${{ !inputs.skip_scan }}'],
      `${name} runs whenever the image was scanned`,
    );
  }
  assert.match(body('Check Scan Report'), /\.scanner\.result\.ArtifactName == \$ref/);
  assert.match(body('Attest Scan Report'), /^ {8}uses: actions\/attest@/m);
  assert.match(body('Attest Scan Report'), /^ {10}predicate-type: \$\{\{ env\.SCAN_PREDICATE \}\}$/m);
  assert.match(job.join('\n'), /^ {6}SCAN_PREDICATE: https:\/\/cosign\.sigstore\.dev\/attestation\/vuln\/v1$/m);
  assert.ok(body('Verify Signature and Attestation').includes('--predicate-type "$SCAN_PREDICATE"'));

  // Tags are written by the promote step only, and `latest` only for a run from main: any other
  // run is signed with its own ref, which a verifier pinned to main rejects.
  const tagging = names.filter((name, i) => steps[i].some((line) => line.includes('imagetools create')));
  assert.deepEqual(tagging, ['Promote Image to Final Tags']);
  assert.match(
    body('Promote Image to Final Tags'),
    /if \[\[ "\$REF" == "refs\/heads\/main" \]\]; then\n\s+published\+=\("\$\{IMAGE\}:latest"\)/,
  );
  for (const other of ['push', 'scan']) {
    assert.doesNotMatch(jobBlock(workflow, other).join('\n'), /imagetools create|:latest/);
  }

  // The operator's tag would otherwise be a second way to move `latest` from any ref.
  assert.match(
    jobBlock(workflow, 'resolve').join('\n'),
    /if \[\[ "\$tag" == "latest" \]\]; then\n\s+echo "::error::[^"]*"\n\s+exit 1/,
  );

  // `a && x || y` falls through to y when x is empty, which would hand one component the
  // other's digest when its own build or scan failed.
  for (const [consumer, producer] of [['scan', 'push'], ['promote', 'push'], ['promote', 'scan']]) {
    const digestLines = jobBlock(workflow, consumer).filter((line) => line.includes(`needs.${producer}.outputs`));
    assert.notDeepEqual(digestLines, [], `${consumer} reads the digests from ${producer}`);
    for (const line of digestLines) {
      assert.doesNotMatch(line, /&&|\|\|/, `pick the digest by component, not with && / ||: ${line.trim()}`);
    }
  }
});

test('promote signs the digest the build pushed, and only if the scan reported that same digest', () => {
  // The scan job runs a third-party scanner and writes its own outputs and report. If promote
  // took the digest from it, a compromised scanner could name another digest of the package
  // (an older release, a staged image that failed its scan) with a clean report, and promote
  // would sign, attest and tag it under the identity the cluster trusts. Admission checks that
  // the attestations name the deployed digest, not that this run built it.
  const workflow = fs.readFileSync(path.join(workflowDir, 'pushdockerimage.yml'), 'utf8');
  const job = jobBlock(workflow, 'promote');
  const needsAt = job.indexOf('    needs:');
  assert.notEqual(needsAt, -1, 'promote lists its needs');
  const needs = [];
  for (let i = needsAt + 1; i < job.length && /^ {6}- /.test(job[i]); i += 1) needs.push(job[i].trim().slice(2));
  assert.ok(needs.includes('push') && needs.includes('scan'), `promote needs push and scan, not [${needs}]`);
  // Both tolerated as success or failure (the components are independent), never skipped.
  const condition = job.join('\n').match(/^ {4}if: (?:>-\n)?([\s\S]*?)\n {4}\S/m)?.[1] ?? '';
  for (const producer of ['push', 'scan']) {
    assert.match(
      condition,
      new RegExp(`needs\\.${producer}\\.result == 'success' \\|\\| needs\\.${producer}\\.result == 'failure'`),
      `promote runs after a finished ${producer}`,
    );
  }

  const steps = job.slice(job.indexOf('    steps:') + 1);
  const stepStarts = steps.flatMap((line, i) => (/^ {6}- /.test(line) ? [i] : []));
  const blocks = stepStarts.map((start, n) => steps.slice(start, stepStarts[n + 1] ?? steps.length));
  const names = blocks.map((block) => (block[0].match(/^ {6}- name: (.+)$/) ?? [])[1]);
  const resolveAt = names.indexOf('Resolve Scanned Digest');
  assert.equal(resolveAt, 0, 'the digest is resolved and compared before any other step');
  const resolve = blocks[resolveAt].join('\n');
  assert.match(resolve, /^ {8}id: image$/m);
  assert.doesNotMatch(resolve, /^ {8}(if|continue-on-error):/m, 'the digest comparison must not be skippable');

  // DIGEST (what is signed) from push; SCANNED (the confirmation) from scan.
  for (const component of ['backend', 'frontend']) {
    const upper = component.toUpperCase();
    assert.match(resolve, new RegExp(`^ {10}${upper}_DIGEST: \\$\\{\\{ needs\\.push\\.outputs\\.${component}_digest \\}\\}$`, 'm'));
    assert.match(resolve, new RegExp(`^ {10}${upper}_SCANNED: \\$\\{\\{ needs\\.scan\\.outputs\\.${component}_digest \\}\\}$`, 'm'));
    assert.match(resolve, new RegExp(`${component}\\) DIGEST="\\$${upper}_DIGEST"; SCANNED="\\$${upper}_SCANNED" ;;`));
  }
  assert.doesNotMatch(resolve, /_DIGEST: \$\{\{ needs\.scan\./, 'the signed digest must not come from the scan job');
  // Unconditional, not only for SCAN == passed: with skip_scan the scan job still reports it.
  assert.match(resolve, /^ {10}if \[\[ "\$SCANNED" != "\$DIGEST" \]\]; then\n\s+echo "::error::[^"]*"\n\s+exit 1\n\s+fi$/m);
  assert.match(resolve, /echo "digest=\$\{DIGEST\}"/);
  assert.ok(
    resolve.indexOf('"$SCANNED" != "$DIGEST"') < resolve.indexOf('>> "$GITHUB_OUTPUT"'),
    'compare before the digest is handed to the later steps',
  );

  // Every step that checks, signs, attests or tags acts on that step's output and nothing else.
  for (const name of ['Check Scan Report', 'Sign Image', 'Attest Build Provenance', 'Attest Scan Report',
    'Verify Signature and Attestation', 'Promote Image to Final Tags']) {
    const at = names.indexOf(name);
    assert.ok(at > resolveAt, `${name} comes after the digest comparison`);
    const block = blocks[at].join('\n');
    assert.match(block, /\$\{\{ steps\.image\.outputs\.digest \}\}/, `${name} uses the compared digest`);
    assert.doesNotMatch(block, /needs\.(push|scan)\.outputs/, `${name} reads no digest of its own`);
  }
});

test('only the promote job can sign, and it runs no build or third-party step', () => {
  // A step that holds `id-token: write` can obtain a certificate with this workflow's identity,
  // so the token stays away from the image build, the scanner and their actions.
  const workflow = fs.readFileSync(path.join(workflowDir, 'pushdockerimage.yml'), 'utf8');
  const promote = jobBlock(workflow, 'promote').join('\n');
  assert.match(promote, /^ {6}id-token: write$/m);
  assert.match(promote, /^ {6}attestations: write$/m);

  const elsewhere = workflow.replace(promote, '');
  assert.notEqual(elsewhere, workflow);
  assert.doesNotMatch(elsewhere, /^\s*(id-token|attestations):/m);
  // `write-all` grants `id-token: write` too, in any job or at the top level.
  assert.doesNotMatch(workflow, /^\s*permissions:\s*write-all\b/m);

  // Every `uses:`, including local composite actions and docker:// images, which have no `@`.
  const uses = [...promote.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((match) => match[1].split('@')[0]);
  assert.deepEqual(uses, [
    'actions/download-artifact',
    'sigstore/cosign-installer',
    'actions/attest',
    'actions/attest',
  ]);
});

test('the scanner runs without a package write token', () => {
  // Trivy (a downloaded binary, a third-party action and databases from a registry) must not
  // hold the token that pushes images or moves tags: the `scan` job may only pull.
  const workflow = fs.readFileSync(path.join(workflowDir, 'pushdockerimage.yml'), 'utf8');
  const scan = jobBlock(workflow, 'scan');
  const start = scan.indexOf('    permissions:');
  assert.notEqual(start, -1, 'scan sets its own permissions');
  const granted = [];
  for (let i = start + 1; i < scan.length && /^ {6}\S/.test(scan[i]); i += 1) granted.push(scan[i].trim());
  assert.deepEqual(granted, ['contents: read', 'packages: read', 'security-events: write']);

  const scanner = /^\s*(?:- )?uses:\s*(aquasecurity\/|\.\/\.github\/actions\/(install-trivy|upload-sarif))/m;
  assert.match(scan.join('\n'), scanner);
  for (const other of ['push', 'promote']) {
    assert.doesNotMatch(jobBlock(workflow, other).join('\n'), scanner, `no scanner step in ${other}`);
    assert.doesNotMatch(jobBlock(workflow, other).join('\n'), /^\s+trivy\s/m, `no trivy command in ${other}`);
  }
});

test('the publish workflow reads and writes no Actions cache', () => {
  // A release build must not restore what another workflow (or a pull request) saved: a
  // poisoned cache would flow into a signed image or its scan. `cache-mode: none` makes the
  // cache service refuse every read and write; the steps also ask for none.
  const workflow = fs.readFileSync(path.join(workflowDir, 'pushdockerimage.yml'), 'utf8');
  assert.match(workflow, /^cache-mode: none$/m);
  assert.doesNotMatch(workflow, /^ {4,}cache-mode:/m, 'no job overrides cache-mode');
  assert.doesNotMatch(workflow, /uses:\s*actions\/cache\b/);
  assert.doesNotMatch(workflow, /type=gha|cache-(from|to):/);
  assert.doesNotMatch(workflow, /cache-node-modules:\s*"?true/);
  const jar = workflow.split('\n').findIndex((line) => line.trim() === 'uses: ./.github/actions/build-backend-jar');
  assert.notEqual(jar, -1);
  assert.ok(stepBlock(workflow.split('\n'), jar).some((line) => line.trim() === 'gradle-cache: disabled'),
    'build the backend JAR with gradle-cache: disabled');
  const lines = workflow.split('\n');
  const trivy = lines.flatMap((line, i) => (/^\s+uses: aquasecurity\/trivy-action@/.test(line) ? [i] : []));
  assert.notDeepEqual(trivy, []);
  for (const i of trivy) {
    assert.ok(stepBlock(lines, i).some((line) => line.trim() === 'cache: false'), `trivy-action at line ${i + 1}`);
  }
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
