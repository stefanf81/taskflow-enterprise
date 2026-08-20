# GitHub Actions Workflow Audit

Audit date: 2026-08-20

Scope: all workflows in this directory, related build configuration, Dockerfiles,
scanner configuration, and current package/artifact behavior. No workflow changes
were made as part of this audit.

## Immediate Actions

### 1. Package cleanup can break retained Docker images

**Files:** `cleanup-packages.yml:61-101`, `pushdockerimage.yml:283-303`

The package cleanup retains tagged OCI indexes, but deletes their untagged child
platform manifests and attestations. A retained tag can therefore reference
deleted content and fail to pull. Existing release tags have already shown this
failure mode.

**Required action:** Disable scheduled deletion, republish any affected tags, and
replace tag-only deletion with manifest-graph-aware retention. Preserve every
child reachable from a retained index, including platform manifests, SBOMs,
provenance, signatures, and shared children. Add dry-run mode, deletion caps,
minimum retained versions, and pre-delete validation.

### 2. Public external-scan artifacts expose production reconnaissance

**File:** `nightly-external-server-scan.yml:14-21,553-561`

Raw Nmap, Nuclei, testssl, and Nikto reports are uploaded from a public
repository. Reports can contain certificate SANs, internal identifiers, and
infrastructure metadata.

**Required action:** Remove existing sensitive artifacts. Move operational scans
and reports to a private repository, encrypt the reports, or upload only a
sanitized summary. Store any non-public target IP or hostname in secrets.

## High-Priority Correctness And Security Findings

### 3. PR path filtering lacks the required permission

**File:** `ci.yml:29-31,74-76`

`dorny/paths-filter@v4` uses the pull request API but the workflow declares only
`contents: read` and `security-events: write`. The `changes` job needs
`pull-requests: read`; otherwise PR runs can fail with a 403 and skip dependent
jobs.

**Fix:** Add job-scoped `contents: read` and `pull-requests: read` permissions to
`changes`. Move `security-events: write` to only the job that uploads SARIF.

### 4. Backend coverage and SpotBugs gates are configured but not run

**Files:** `ci.yml:210-255`, `build.gradle:147-153,222-235,265-267`

CI runs tests and creates a JaCoCo report but does not invoke
`jacocoTestCoverageVerification`, SpotBugs, or the Gradle `check` lifecycle.
Configured failures can therefore merge without blocking CI.

**Fix:** Run `check` in the backend quality job, or invoke the coverage and
SpotBugs verification tasks explicitly.

### 5. Production image publication is not restricted to trusted CI-passed code

**File:** `pushdockerimage.yml:25-45,132-190,339-347`

A dispatcher can select any branch, bypass Trivy, and replace `latest`. The
workflow does not verify successful CI for the selected SHA, and publication has
no protected environment approval.

**Fix:** Limit publication to `main` or protected release tags, require a
successful CI run for the exact SHA, use a protected production environment, and
require separate approval to skip scanning.

### 6. Manual Docker tag input is interpolated into shell source

**File:** `pushdockerimage.yml:79-89`

`${{ inputs.image_tag }}` is inserted directly into a shell assignment. Workflow
dispatch access reduces exposure, but malicious input can still execute shell
substitution in a package-write workflow.

**Fix:** Pass the input through `env`, validate it against Docker tag syntax and
length, reject reserved staging suffixes, remove unnecessary checkouts, and set
`persist-credentials: false` where checkout is required.

### 7. Image scan and promotion use mutable tags

**File:** `pushdockerimage.yml:292-347`

Scanning and promotion resolve a mutable `:<tag>-scan` reference. Concurrent
runs can scan one digest and promote another; separate runs can also race to
assign `latest`.

**Fix:** Scan and promote the immutable image digest, use a run-unique staging
tag, serialize all `latest` promotions with repository-wide concurrency, and
publish `latest` only from the trusted release ref.

### 8. Dependency and code security review is post-merge only

**Files:** `security.yml:3-7`, `ci.md:68-73`, `ci.yml:292-323`

CodeQL runs only on schedule/manual dispatch. No Dependency Review workflow is
present despite documentation claiming that it was moved to `security.yml`.
Dependency submission is not an equivalent pre-merge vulnerability gate.

**Fix:** Add PR-triggered Dependency Review and CodeQL coverage. Configure a
branch ruleset requiring pull requests and the relevant CI, secret scanning,
CodeQL, and dependency-review checks.

### 9. External scanner failures are treated as successful scans

**File:** `nightly-external-server-scan.yml:304-375,567-594`

testssl and Nikto use broad `continue-on-error` and `|| true`; only Nuclei is
gated at the end. Container permission errors have produced successful runs with
no usable testssl or Nikto reports.

**Fix:** Provide writable output directories with compatible ownership, require
each expected report to be non-empty, and fail incomplete scans. Handle scanner
finding exit codes separately from operational failures.

### 10. E2E coverage skips most single-stack pull requests (resolved)

**Resolved 2026-08-20.** `ci.yml` now builds both application artifacts whenever
either backend or frontend changes, then downloads the production frontend bundle
and serves it through the hardened Nginx image. Playwright runs with
`E2E_DOCKER=true`, exercising the production bundle and reverse proxy instead of
the Angular development server.

### 11. API DAST failure prevents frontend DAST (resolved)

**Resolved 2026-08-20.** Both ZAP actions use `continue-on-error`, the frontend
scan has `if: ${{ !cancelled() }}`, and a final aggregate step fails the job when
either scan did not succeed. Both report and SARIF upload paths therefore run
before the DAST gate is evaluated.

Remaining DAST improvements include upgrading and SHA-pinning the ZAP actions,
adding AJAX crawling, and managing a ZAP rules file for the SPA.

### 12. k6 can pass without completing the booking flow

**File:** `k6/browser.js:100-211`

Several required UI transitions are optional or evaluate successful checks when
elements, slots, or inputs are missing. A one-VU, one-iteration workflow is only
a browser smoke test and cannot support meaningful p95 claims.

**Fix:** Require each booking transition and observable state, use seeded
availability, remove unconditional successful checks, and add sustained load
with persisted reports when enforcing performance objectives.

## Medium-Priority Findings

### 13. Docker component matrix can contain an empty component (resolved)

**Resolved 2026-08-20.** The selector now uses `jq -cn '$ARGS.positional' --args`
and emits `[]` with no selected components. Docker context, Nginx, entrypoint,
ignore, Compose, and Trivy-policy changes are mapped to applicable image
components; the Docker job skips an empty matrix. Compose validation remains a
separate improvement.

Previously, serializing an empty Bash array with `printf` produced an invalid component array.
Prior to resolution, important Docker-context files were not mapped, including `.dockerignore` and
`.trivyignore`; only `Dockerfile.x64` was linted despite changes to `Dockerfile`
triggering backend processing.

**Fix:** Create JSON with `jq -cn '$ARGS.positional' --args "${components[@]}"`,
expose a non-empty output, map relevant context files, lint both Dockerfiles,
and validate Compose separately.

### 14. Generated API contracts can drift on frontend-only changes

**Files:** `scripts/sync-api-types.js:17-20`, `ci.yml:218-228`

The contract consistency check is run only in the backend job. A frontend-only
edit to generated API types can bypass it.

**Fix:** Add a small dedicated contract job, or run `npm run
sync:api-types:check` in both frontend and mobile JavaScript jobs.

### 15. Mobile native coverage is post-merge only

**Files:** `react-native-ci.yml:96-100,180-183,207-211,290-318`,
`mobile/package.json:12-15`

Native builds run only scheduled/manual and no workflow runs Detox. Native
configuration and device-level journey regressions can merge without validation.

**Fix:** Run a fast relevant native build on PRs and at least one Detox platform
nightly. Archive iOS `.app` bundles before artifact upload to preserve executable
permissions.

### 16. Concurrency cancels scheduled native and secret scans

**Files:** `react-native-ci.yml:37-39`, `gitleaks.yml:22-24`

Pushes, PRs, manual runs, and schedules can share concurrency groups on `main`.
A normal push can cancel a scheduled full native build or a secret scan. Gitleaks
also uses one SARIF category for incremental and full-history scans.

**Fix:** Cancel only obsolete PR runs and include event type in concurrency
groups. Use distinct SARIF categories for PR, push-delta, and full-history
Gitleaks results.

### 17. Security-sensitive actions and images are mutable

**Files:** `security.yml`, `gitleaks.yml`, `dast.yml`,
`nightly-external-server-scan.yml`, `pushdockerimage.yml`

Actions use major tags and scanner/base images use mutable tags such as `stable`
or `latest`, reducing reproducibility and increasing supply-chain exposure.

**Fix:** Pin actions to reviewed full commit SHAs and container images to digests.
Use Dependabot to maintain GitHub Actions and digest updates.

### 18. Gitleaks can be weakened by the PR it scans

**File:** `gitleaks.yml:38-49`

The scan honors root Gitleaks configuration from the PR checkout. A pull request
can add ignore rules that suppress its own secret findings.

**Fix:** Load scanner configuration from the protected default branch or run an
additional immutable-config scan. Protect workflows and scanner configuration
with a ruleset and CODEOWNERS.

### 19. Trivy policy does not match its stated severity gate

**Files:** `pushdockerimage.yml:311-330`, `ci.yml:754-776`, `.trivyignore:1-7`

SARIF generation currently includes all severities, while `ignore-unfixed: true`
allows unfixed HIGH/CRITICAL findings. Global `.trivyignore` exceptions lack
scope and expiry.

**Fix:** Use a dedicated HIGH/CRITICAL enforcement scan and an all-severity
report-only SARIF scan. Decide whether unfixed critical findings may publish.
Use scoped, justified, expiring `.trivyignore.yaml` entries and remove stale
suppression entries.

### 20. External scans do not reliably target the intended hostname

**File:** `nightly-external-server-scan.yml:14-21`

The target host falls back to an IP. HTTP/TLS virtual-host routing and SNI may
therefore differ from the production hostname.

**Fix:** Require an explicit hostname and separately define edge and origin scan
targets. For origin scans, pin hostname resolution to the origin IP.

## Lower-Priority Reliability And Performance Work

- Main-branch job gating now respects path filters, so documentation-only pushes
  skip heavyweight CI work while scheduled and manual runs remain comprehensive.
- Nuclei target duplication was resolved on 2026-08-20. HTTP services now use
  canonical URLs and only genuine non-HTTP services use `host:port` targets.
- Frontend and native Node cache keys now include
  `shared/schemas/package-lock.json`.
- iOS native dependency resolution is not lockfile reproducible because CocoaPods
  state is generated in CI.
- `cleanup-packages.yml` and `delete-old-caches.yml` suppress API failures. Treat
  only expected 404 races as successful, retry 429/5xx responses, and fail after
  accumulated deletion errors.
- Image base references and Alpine package installs are mutable. Pin image
  digests and schedule controlled base-image updates where reproducibility is
  required.
- `APK_BUST` is passed to the frontend image but not consumed there, so frontend
  OS package layers are not invalidated as intended.
- Uploaded Gitleaks artifacts include a nonexistent `results.json`; remove it and
  avoid duplicate SARIF artifact retention.
- `ci.md` is stale regarding dependency review, permissions, Docker behavior,
  Trivy component count, and JVM flags. Update it alongside workflow changes.

## Positive Practices

- Most jobs define explicit timeouts.
- JavaScript dependency installation uses `npm ci`.
- Backend tests include H2 and PostgreSQL Testcontainers coverage.
- DAST uses disposable local infrastructure and masks its bearer token.
- PR workflows do not use `pull_request_target` and do not expose production
  secrets to untrusted pull requests.
- BuildKit provenance and SBOM attestations are generated for published images.
- Docker publication is isolated behind a manual workflow.
- Scanner reporting generally uses bounded artifact retention and `always()` for
  report uploads.

## Recommended Remediation Order

1. Disable unsafe package cleanup, republish broken tags, and remove sensitive
   public scan artifacts.
2. Fix PR permissions, scanner false-success behavior, shell injection, and
   digest-based image scanning/promotion.
3. Restore pre-merge Dependency Review and CodeQL, then enforce required checks
   with a repository ruleset.
4. Run configured backend quality gates and generated-contract verification.
5. Rework E2E and k6 so their gates reflect production behavior and actual user
   journeys.
6. Make concurrency event-aware, reduce unnecessary builds/scans, pin actions
   and images, and update stale workflow documentation.
