# TaskFlow Enterprise CI/CD Documentation

This document explains the configuration of the `.github/workflows/ci.yml` file, detailing the state-of-the-art practices implemented, why they were chosen, and how each step contributes to a highly optimized, secure, and cost-effective CI/CD pipeline.

---

## 1. Trigger Configuration (`on`)

The workflow is triggered on pushes and pull requests to the `main` branch. On Pull Requests, available test jobs are gated by path filtering (see below) — the backend test suite and frontend unit tests run when either application stack changed, and Playwright E2E runs for every backend or frontend change.

It also includes a `workflow_dispatch` trigger with a boolean input for manual runs:

- `run_tests`: Toggles unit tests, integration tests, and Playwright E2E tests across both the frontend and backend on manual runs (default: true).

A daily **schedule** (`0 2 * * *`) runs the full build, test, and Docker build+scan pipeline as a nightly regression suite. Security-only scans (CodeQL, Trivy filesystem) are handled by the separate `.github/workflows/security.yml` workflow (staggered to the same 02:00 UTC window).

> **Gating behavior honors path filtering on PRs and ordinary `main` pushes.** A backend or frontend change builds both application artifacts so E2E can exercise their production integration. Docker-only changes continue to build only their affected artifact. Documentation-only pushes skip heavyweight jobs; the daily schedule remains the full regression suite. Unit/integration tests run on application changes, on the daily schedule, and on manual `workflow_dispatch` runs with `run_tests: true`.

**Why:** This runs a comprehensive and rigorous set of quality gates on every PR (subject to the path-filtering rules above), while offering fine-grained toggles for custom manual developer runs.

## 2. Concurrency (`concurrency`)

```yaml
concurrency:
  group: taskflow-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**Why:** If a developer (or Renovate) pushes multiple commits to a branch in rapid succession, GitHub Actions cancels the older, now-obsolete pipeline runs. This saves significant compute minutes and prevents a queue of stale builds. `main` is included because merge bursts otherwise queue a full ~6-minute run per commit; the surviving run always verifies the cumulative tree, and required status checks are evaluated per pull request, so cancelling a superseded `main` run has no effect on merge gating.

## 3. Least-Privilege Permissions (`permissions`)

`ci.yml` declares a workflow-level default of `contents: read` only. Every job that needs more receives it job-scoped:

- `changes`: `contents: read` + `pull-requests: read` — `dorny/paths-filter` lists pull-request changed files through the REST API, which requires `pull-requests: read`.
- `docker-build`: `contents: read` + `security-events: write` — the only job that uploads SARIF.
- `dependency-submission`: `contents: write` + `actions: write`.

`packages: write` is deliberately **not** granted in `ci.yml` (it never pushes images); it belongs to the manual [`pushdockerimage.yml`](../../.github/workflows/pushdockerimage.yml) publication workflow.

**Why:** Adheres to the Zero-Trust security model. If a malicious dependency somehow compromises the runner, the blast radius is severely limited because the `GITHUB_TOKEN` lacks sweeping repository write access.

## 4. Job: `changes` (Path Filtering)

Uses `dorny/paths-filter@v4` to detect exactly which files changed in a PR or push. The job is granted `pull-requests: read` (see above) because the action lists PR files through the REST API. We enforce a 5-minute timeout on this job to prevent it from stalling.
The filters distinguish backend, frontend, dependency-submission, and Docker component changes. Docker context files, Nginx configuration, entrypoints, ignore files, and Trivy policy are mapped to the affected image. The selector emits a valid empty JSON array when no image needs processing.
**Why:** Monorepos (where frontend and backend live together) waste massive amounts of time running backend tests when only a CSS file changed, or vice versa. This step dynamically determines whether the backend, frontend, or both need to run (and similarly, which Docker images actually need to be built), completely skipping unaffected pipelines and avoiding missing build artifact failures.

## 5. Job: `lint` (Dockerfile Lint)

A lightweight job that runs `hadolint` against `Dockerfile.x64` and `frontend/Dockerfile` to verify linting and compliance. It only runs if Docker-related files were changed. The backend lint intentionally ignores `DL3005` (`apt-get upgrade`) and `DL3008` (apt version pinning) because the runtime stage refreshes Ubuntu security packages on every build instead of pinning versions that would freeze out CVE fixes (the same rationale as the frontend's ignored `DL3018`).
**Why:** Fails fast. By running these checks early and separately, we don't waste 5 minutes booting up JVMs and Node environments just to tell a developer they missed a Dockerfile best practice.

## 6. Job: `backend`

This job handles the Spring Boot backend compilation, testing, and quality gates.

- **Automatic & Conditional Test Execution:**
  Unit and integration tests run automatically on all Pull Requests. On manual runs (`workflow_dispatch`), they are executed conditionally if `run_tests` is enabled, or skipped entirely to fast-track packaging.
- **Gradle Task Parallelism & Caching:** We explicitly pass the `--parallel` and `--build-cache` arguments to `./gradlew`. This compiles independent modules across multiple threads, leveraging build outputs from previous runs. On the nightly `schedule` the flag flips to `--no-build-cache`: `setup-gradle` restores the Gradle user home build cache, so otherwise `test` and `testcontainersTest` resolve `FROM-CACHE` on an unchanged tree and the nightly regression executes no tests.
- **Gradle Caching Write Access (`cache-read-only: false`):** We configure `cache-read-only: false` on the setup-gradle action. By default, setup-gradle disables cache writes on non-default branches (e.g. Pull Requests). Overriding this ensures that PR branches can cache new/updated dependencies, avoiding slow downloads on subsequent commits.
- **Combined Build, Tests, and Quality Gates:** A single Gradle invocation runs `assemble`, `test`, `testcontainersTest`, `jacocoTestReport`, `jacocoTestCoverageVerification`, and `spotbugsMain`. The enforced gates — JaCoCo coverage ≥ 0.80 and SpotBugs at MAX effort / HIGH confidence — therefore block the build instead of only producing reports. `assemble` stays in this invocation because the OpenAPI contract verification boots the locally built JAR; when `run_tests` is disabled, the packaging-only `assemble` fallback keeps that JAR available.
- **Direct Artifact Uploads:** Instead of manually compressing reports into a `.tar.gz` archive, we upload the `build/reports` and `build/test-results` directories directly using `actions/upload-artifact@v7` with a 14-day retention period. The production JAR artifact is owned by the `package` job (see §6a).
- **OpenAPI Contract Gate:** After the build, CI starts the backend through the shared `start-backend` composite, authenticates through the mobile login endpoint, and compares the live `/v3/api-docs` document with `api/openapi.json`. It also fails if either generated platform API type file is stale. API changes therefore require a reviewed baseline update and regenerated types in the same change.

## 6a. Job: `package` (Backend Package)

Produces the production JAR artifact consumed by downstream jobs, independently of the test suite.

- **Fan-Out From Testing:** `package` runs only `./gradlew assemble` and uploads `backend-jar`. `docker-build` and `e2e` declare `needs: [changes, package, frontend]`, so the image build/scan and Playwright start as soon as the JAR and frontend bundle exist instead of waiting for `test`, `testcontainersTest`, and `spotbugsMain` to finish. The test suite continues concurrently inside the required `Backend` job.
- **Gating:** `package` mirrors the `backend` job's path filters, so documentation-only diffs skip it. A `package` failure skips `docker-build` and `e2e`; because `End-to-End Tests` is a required status check, a skipped required check blocks the merge exactly as a failing `backend` job does today.
- **Single Source of Truth for the Artifact:** Only `package` uploads `backend-jar`, so the artifact name is unique per run. The OpenAPI contract gate intentionally stays in the `backend` job so the required `Backend` check still covers it; the duplicate `assemble` costs seconds and is served from the Gradle build cache.

## 7. Job: `frontend`

Handles the Angular 22 frontend linting, unit tests, and production distribution builds.

- **Built-in Global NPM Cache (`actions/setup-node@v7`)**:
  Leverages the native `cache: npm` and both frontend and shared-schema lockfiles. This reduces manual configuration boilerplate, manages branch-scoped cache restoration automatically before any installations occur, and invalidates cached packages when either installed dependency graph changes.
- **Angular Build Caching:**
  We use `actions/cache` targeted directly at `frontend/.angular/cache`, keyed by the runner's OS and the `package-lock.json` hash. This stores compilation outputs across workflow runs and makes subsequent builds and tests significantly faster.
- **Bypassing Redundant Prettier Runs:**
  Rather than calling `npm run test` and `npm run build`, we call `npx ng test` and `npx ng build` directly. This prevents triggering the NPM pre-lifecycle hooks (`pretest`, `prebuild`) which otherwise run formatting checks multiple redundant times.
- **Conditional Testing:** Unit tests and coverage outputs run automatically by default on every Pull Request, and can be bypassed on manual triggers if `run_tests` is disabled.
- **Direct Coverage Artifacts:** We upload the test coverage reports directly using `actions/upload-artifact@v7` with a 14-day retention period, rather than manually compressing them into `.tar.gz` files.

## 7a. Job: `dependency-submission` (Dependency Graph Submission)

Submits the complete, deep Java and Gradle dependency tree directly to the GitHub Dependency Submission API.

- **Dependency Graph Submission:** Uses `gradle/actions/dependency-submission@v6` to extract, compile, and upload the full transitive dependency graph on relevant `main` runs. GitHub uses this graph for dependency visibility and vulnerability alerts; Renovate applies this repository's controlled update policy.
- **Caching & Permissions:** Explicitly configured with `contents: write` and `actions: write` permissions. The `actions: write` permission is crucial to allow the Gradle Action to save and restore dependencies caching successfully, preventing "cache write denied" warnings while maximizing the build execution speed on subsequent runs.
- **Why the workflow job instead of GitHub's native automatic submission:** the native integration runs a GitHub-managed `dynamic` workflow (~1m37s per push, submitting from PR branches too), while this scoped job completes in ~33s and only runs for Gradle-file changes on `main`/dispatch/schedule. The native **Automatic dependency submission** setting is disabled in repository settings so the two paths cannot submit duplicate snapshots; re-enable it only if this job is removed.

## 8. Job: `security` — moved to `security.yml`

> The Trivy filesystem scan has been extracted to a dedicated nightly workflow, [`.github/workflows/security.yml`](../../.github/workflows/security.yml). This keeps the CI/CD pipeline focused on build, test, and deployment, while security-only scans run independently on the nightly schedule (and on demand via `workflow_dispatch`). Dependency visibility is handled by the separate dependency-submission job described above.

See [`security.yml`](../../.github/workflows/security.yml) for details on:

- **Trivy Filesystem Scan:** Report-only (`exit-code: 0`, `scanners: vuln`) SARIF upload partitioned across four distinct components: Backend (`.`), Frontend (`frontend/`), Mobile (`mobile/`), and Shared Schemas (`shared/schemas/`), surfaced in the Code Scanning tab with dedicated category namespaces. Non-component and build directories (`node_modules/`, `build/`, `.gradle/`, `dist/`, `android/`, `ios/`, `.git/`) are explicitly excluded. Severity asymmetry vs. the Docker image hard gate is deliberately maintained — see the inline notes.
- **Trivy Database Caching:** `trivy-action` manages its own workspace-local
  vulnerability database cache and binary cache. The workflows do not layer a
  second cache over it.
- **Hardened Execution & Least Privilege:** Runs with scoped permissions (`contents: read`, `security-events: write`), omitting unneeded package tokens, and checks out the workspace with `persist-credentials: false`.

## 8a. Job: `codeql` — moved to `security.yml`

> CodeQL analysis (`java-kotlin` + `javascript-typescript`) has also been extracted to `.github/workflows/security.yml`.

Runs deep semantic security analysis in parallel for both languages on every nightly run:

- **Java/Kotlin (`build-mode: autobuild`):** CodeQL performs its own Gradle build tracking with `actions: write` permission for Gradle build caching — it does not consume the production JAR from the `package` job, so there is no serialization bottleneck.
- **JavaScript/TypeScript (`build-mode: none`):** Scans the Angular 22 and React Native TypeScript sources directly without building, keeping the analysis lightweight.
- **Extended Security Queries:** Configured with `queries: security-extended` to perform deep semantic checks for injection flaws, authentication bypasses, path traversals, and cryptographic weaknesses beyond the minimal default suite.
- **Matrix Naming & SARIF Category Isolation:** Job matrix displays distinct language names (`CodeQL (${{ matrix.language }})`) and emits SARIF results categorized under `/language:${{ matrix.language }}`. Workspace checkout runs with `persist-credentials: false`.

The standalone workflow has no change-detection dependency — it always scans both languages on every scheduled/manual run.

## 9. Job: `e2e` (End-to-End Tests)

Runs Playwright E2E tests against a real, running backend and database.

- **Decoupled dependencies (`needs: [changes, package, frontend]`)**:
  The E2E job depends on the packaged backend JAR and the production frontend bundle — not on the test suite — so Playwright starts as soon as the artifacts exist while unit/integration tests run concurrently in the required `Backend` job.
- **Fast Service Readiness:** The PostgreSQL and Redis service containers use `--health-interval 2s --health-timeout 2s --health-retries 30`, so GitHub's `Initialize containers` phase detects readiness within seconds instead of waiting out a 10-second health interval — the E2E job's largest fixed cost.
- **Single-Stack PR Coverage:** On Pull Requests, any backend or frontend change builds both application artifacts and runs E2E. This intentionally trades the extra untouched-stack build for production integration coverage on every application change. Docker-only changes retain component-specific build behavior.
- **Production Ingress:** E2E downloads the frontend production bundle, builds the production Nginx image with a BuildKit GHA cache that restores the shared `frontend-main`/`frontend-pr` scopes and writes a dedicated `frontend-e2e` scope, then serves it on port 4200 with the same read-only filesystem and dropped capabilities used by Compose. Playwright sets `E2E_DOCKER=true`, so it tests the production bundle and reverse proxy instead of `ng serve`.
- **Playwright Browser Cache Keyed by Playwright Version:** Playwright browsers are cached under a key derived from the resolved `playwright-core` version in `frontend/package-lock.json`, so unrelated frontend dependency bumps no longer invalidate ~300 MB of browsers and force `playwright install --with-deps` (12–18s) on every run. The cache key naturally rotates when Playwright itself is upgraded, and `cache-hit` still gates the install step.
- **Cache-Aware Browser Installation:** Instead of installing all available major browsers (Chromium, Firefox, WebKit), we only install `chromium` (`npx playwright install --with-deps chromium`), which matches the Desktop Chrome browser used in `playwright.config.ts`. The install runs only on a Playwright cache miss, so `--with-deps` does not re-run `apt` on every build.
- **Direct Playwright Reports Upload:** We upload `spring.log`, `frontend/playwright-report`, and `frontend/test-results` directly using the `upload-artifact` action with default compression and a 7-day retention policy; these text-heavy artifacts compress well, so the default keeps storage down.

## 9a. DAST (Dynamic Application Security Testing) — see `dast.yml`

> The OWASP ZAP scan lives in its own dedicated workflow file, [`dast.yml`](../../.github/workflows/dast.yml), and is no longer embedded in `ci.yml`. It is triggered on the daily schedule (staggered to **02:30 UTC**, off the 02:00 herd) and via manual `workflow_dispatch`.

Runs authenticated OWASP ZAP API and web scans against a disposable full-stack environment.

- **Dynamic Environment Provisioning:** Provisions PostgreSQL and Redis service containers on the runner to provide a fully clean integration environment.
- **Standalone Build:** Builds the backend with `./gradlew bootJar` (matching the production artifact) and boots it with `SPRING_PROFILES_ACTIVE=prod`, then waits for the `/actuator/health/liveness` endpoint to be healthy before scanning.
- **Authenticated API Scan:** Uses `zaproxy/action-api-scan@v0.10.0` with the canonical `api/openapi.json` definition and a bearer token issued by the disposable backend. This enumerates documented public and protected API operations without exposing a production credential.
- **Production Ingress Scan:** Builds and runs the production frontend Nginx image with the same read-only filesystem and capability restrictions used by Compose, then scans `http://localhost:4200` through its API proxy with headless browser AJAX spidering (`-j`) to discover dynamic Angular SPA routes.
- **Parameterized Manual Dispatch:** Supports manual `workflow_dispatch` with options for scan scope (`all`, `api_only`, `web_only`), AJAX spider toggle, and quality gate override (`fail_on_findings: false` for triage).
- **Independent Scan Completion:** API and frontend ZAP scans each continue long enough for the other scan and all report/SARIF uploads to complete. A final aggregate step evaluates active scans while respecting skipped targets and quality gate settings, preserving both coverage and blocking behavior.
- **Interactive Security Reports:** Archives the API and web HTML, JSON, Markdown, SARIF, and backend logs as the `zap-full-scan` artifact (14-day retention), with structured collapsible Markdown summaries rendered in GitHub Step Summary.
- **GitHub Security (GHAS) Code Scanning Integration:** Translates raw API and web ZAP findings into SARIF via `scripts/zap2sarif.py` and uploads separate `dast-zap-api` and `dast-zap-web` categories. Invalid source reports and SARIF write failures fail the workflow rather than being reported as zero findings.

## 9b. External Server Security Scan — see `nightly-external-server-scan.yml`

> The external production boundary scan lives in [`.github/workflows/nightly-external-server-scan.yml`](../../.github/workflows/nightly-external-server-scan.yml). It is scheduled nightly (**03:00 UTC**, after DAST and regression suites) and available on-demand via parameterized `workflow_dispatch`.

Audits the public external perimeter, exposed ports, HTTP/TLS compliance, and web application attack surface against the production host.

- **Two-Job Parallel Execution:** Dispatches concurrent jobs to optimize compute time from 60–90 minutes down to ~10–15 minutes:
  - `network-scan`: Scans the target IP with Nmap across configurable port scopes (`top_1000` fast probe, `full_65k` deep audit, or `expected_only`). Automatically flags any ports outside `EXPECTED_PUBLIC_TCP_PORTS: "80,443"` and runs non-intrusive safe service scripts on open ports.
  - `web-scan`: Tests the public web perimeter (`Nuclei`, `testssl.sh`, and `Nikto`).
- **Origin IP & SNI Alignment:** Pins `TARGET_HOST` to `TARGET_IP` in `/etc/hosts` and passes `--add-host` to containerized scanners, eliminating CDN/DNS resolution drift while preserving exact TLS SNI and HTTP `Host` virtual routing.
- **Port 80 Redirect Verification:** Validates that port 80 enforces an immediate HTTP-to-HTTPS redirect (301/302/307/308) to the target domain, including it in web analysis rather than misclassifying it as a non-HTTP protocol.
- **Strict Quality Gates:**
  - Fails if unexpected public TCP ports are open.
  - Fails if Nuclei detects `HIGH` or `CRITICAL` findings.
  - Fails if `testssl.sh` detects `CRITICAL` or `HIGH` TLS vulnerabilities (e.g. SSLv3, POODLE, Heartbleed, expired certs).
  - Fails on operational scanner crashes or missing/empty reports (preventing false successes).
- **Reconnaissance Protection:** Raw network and scanner dumps are excluded from public artifacts by default (`upload_raw_artifacts: false`). Sanitized tables and metrics are rendered in GitHub Step Summary, while Nuclei findings upload to GitHub Code Scanning via SARIF.

## 10. Job: `docker-build`

Compiles secure, production-grade container images for the backend and frontend components.

> **Image publication is intentionally excluded from CI.** Docker images are built and scanned locally in CI but never pushed to GHCR. Publication is an explicit operator action via the dedicated [`.github/workflows/pushdockerimage.yml`](../../.github/workflows/pushdockerimage.yml) workflow — see that file for the push pipeline.

- **Deduplicated Multi-Tag Builds:** Both the unique commit SHA (`IMAGE_TAG`) and `latest` tags are defined simultaneously in the `docker/build-push-action` step. This ensures Buildx executes a single build compilation graph, tagging the resulting local image under both tags at once.
- **Lowercase GHCR Owner Guard:** GHCR rejects mixed/uppercase repository owners (`repository name must be lowercase`). A `Compute Image Refs` step lowercases `github.repository_owner` once and exhales fully-resolved `ghcr.io/<owner>/taskflow-{backend,frontend}` refs as step outputs, which `build-push-action` and the Trivy `image-ref` both consume. This prevents hard-failures for forks/orgs whose casing doesn't match the package's lowercase requirement.
- **Local Load Only:** Images in CI (`ci.yml`) are built with `load: true`, `push: false`, `provenance: false`, `sbom: false`. GHA Buildx local loading does not support image index structures containing supply-chain annotations, so attestations are omitted. The `pushdockerimage.yml` workflow builds once to a temporary registry scan tag (`:<tag>-scan`) with `provenance: true` / `sbom: true`, scans that exact image on GHCR, and promotes it to `:<tag>` and `:latest` using `docker buildx imagetools create` without rebuilding.
- **Dynamic Matrix Execution:** Instead of a hardcoded matrix that tries to build both components and fails when compilation is skipped, we use a dynamic `docker_components` output array calculated in the `changes` job. This only compiles and scans images that actually had changes.
- **Artifact-Driven Fan-In:** The job declares `needs: [changes, package, frontend]` and pulls the backend JAR and frontend bundle from those jobs' artifacts, so image build and Trivy scan no longer wait for the backend test suite to complete.
- **Smart Job-Level Gating (Skip Optimization):** Job-level conditions respect path filters on both pull requests and ordinary `main` pushes. Documentation-only changes skip heavyweight runners, while scheduled and manual runs retain full coverage. The matrix uses a valid empty array rather than a sentinel component.
- **Hard-Gate Trivy Scan:** The image is scanned with `exit-code: 1` and `severity: HIGH,CRITICAL` — a blocking gate. This is the intentional counterpart to the report-only Trivy filesystem scan in `security.yml`. If a high/critical CVE is found, the build fails but the SARIF is still uploaded (via `if: always()`).
- **GHA Cache for BuildKit:** The `cache-from` / `cache-to` directives use GitHub Actions cache (`type=gha`) with scoped keys per component and branch, so PR builds reuse layers from `main` when possible.
- **Manual Trigger Bypass (`workflow_dispatch`):** Added the manual trigger check to all job-level `if` checks to ensure that clicking "Run workflow" in GitHub UI actually executes the pipeline on any branch, instead of silently skipping due to lack of file changes.

## 11. Container & JVM Hardening (SOTA)

Our Docker build configurations (`Dockerfile` and `Dockerfile.x64`) implement state-of-the-art container optimization techniques:

- **Architecture-Independent Layer Extraction:** JAR extraction runs natively on `$BUILDPLATFORM` without emulation via Spring Boot tools (`RUN --network=none java -Djarmode=tools -jar application.jar extract --layers --destination extracted`), producing an optimized `application.jar` + `lib/` layout.
- **COPY --link:** Copies multi-stage compiled artifacts using independent image layers, bypassing full filesystem rewrites and facilitating immediate image layer linking.
- **Isolated JVM Class Data Sharing (CDS / AppCDS):**
  - Executes a network-isolated headless training run in a dedicated `cds-training` stage under non-root UID `10001`:
    ```dockerfile
    RUN --network=none java -XX:ArchiveClassesAtExit=/tmp/application.jsa \
             -Dspring.context.exit=onRefresh \
             -Dapp.cds-training=true \
             -Dspring.flyway.enabled=false \
             -Dspring.cache.type=redis \
             -Dotel.sdk.disabled=true \
             -cp application.jar com.example.cdstraining.CdsTrainingApplication \
        && test -s /tmp/application.jsa
    ```
  - Copies only the generated archive into runtime (`COPY --link --from=cds-training --chown=0:0 --chmod=0444 /tmp/application.jsa ./application.jsa`), preventing training artifacts or caches from bloating the production image.
  - Separates CDS training from the final stage's package-refresh layer (`APT_BUST` → `apt-get upgrade` on the backend's Ubuntu-based Temurin image, `APK_BUST` → `apk upgrade` on the frontend's Alpine image): routine OS security package refreshes reuse the cached CDS archive instead of retraining on every build.
  - Validates archive mapping at image build time using `--mount=type=tmpfs,target=/tmp` and `-Xshare:on`.
  - Mounts the shared archive at runtime via sizing-agnostic `CMD` arguments `"-XX:SharedArchiveFile=application.jsa"` and `"-Xshare:auto"`, launching the extracted JAR directly with `"-jar", "application.jar"`.
  - **Results:** Eliminates class-loading overhead, reducing cold-start times by ~20% (~740 ms saved, with over 15,000 application and framework classes mapped directly from the archive).

---

## 12. Repository & GHCR Setup

The Docker push workflow (`.github/workflows/pushdockerimage.yml`) pushes images to the GitHub Container Registry (GHCR) using the default `GITHUB_TOKEN`.

### Workflow permissions

1. Repository **Settings → Actions → General**.
2. Under **Workflow permissions**, select **Read and write permissions** (required so the token can push packages and write security events).
3. Click **Save**.

### Linking packages to the repository (if they already exist)

If you previously pushed `taskflow-backend` / `taskflow-frontend` manually (e.g. via a PAT), those packages are owned by your profile rather than the repository token:

1. On your GitHub profile, open **Packages → taskflow-backend** (and `taskflow-frontend`).
2. **Package settings → Manage Actions access → Add repository**, select this repository, and grant **Write**.

### Personal Access Token fallback (`CR_PAT`)

If organization policy blocks workflow write permissions, create a classic PAT with `write:packages` (and optionally `delete:packages`) and store it as a repository secret named `CR_PAT`. Then change the `docker/login-action` step in `pushdockerimage.yml` to use `password: ${{ secrets.CR_PAT }}`.

## 13. Automated Dependency Updates

`.github/workflows/renovate.yml` runs Renovate daily and on demand. Renovate
uses the `RENOVATE_TOKEN` secret instead of `GITHUB_TOKEN`, because pull
requests created with `GITHUB_TOKEN` require manual workflow approval. The
current secret is a PAT with repository and workflow access so Renovate can
write branches, pull requests, issues, statuses, and GitHub Actions updates.
The workflow includes pre-flight schema validation via
`renovate-config-validator`, repository caching (`actions/cache`), and
interactive `workflow_dispatch` inputs (`dryRun`, `logLevel`, `repoCache`).

Renovate opens reviewable PRs for all dependency updates. Ordinary patch, pin,
and digest updates enable platform automerge after required CI checks pass and
a 3-day release quarantine soak expires to protect against supply-chain attacks.
Minor updates require manual review (also holding for 3 days to catch immediate
regressions). Major updates are held for 30 days and require manual review.
Security vulnerability alerts bypass the release quarantine so CVE patches open
immediately with a `security` label. Routine lock-file maintenance runs weekly
on Monday mornings, deduplicating npm workspaces via `npmDedupe`.
Branches use `rebaseWhen: auto` globally to avoid rebase churn, while automerging
patch PRs override to `rebaseWhen: behind-base-branch` to satisfy branch protection.
`ci.yml` detects same-repository `renovate/` branches and runs the backend,
frontend, Testcontainers, and Playwright suites regardless of path filters.
`react-native-ci.yml` path-filters pull requests (mobile, shared schemas, API
contract, and the sync script) so unrelated PRs skip the mobile JavaScript
check, and runs Android and iOS native jobs for same-repository Renovate and
`maintenance/expo-sdk` branches. Its concurrency group includes the event name
and only cancels pull-request runs, so a push to `main` cannot cancel the
nightly native build.

The following version-coupled ecosystems are grouped into cohesive Renovate
PRs: Angular and its toolchain, Tailwind CSS, Zod across monorepo packages,
Spring Boot plugin/BOM, Flyway, Hibernate, Netty, Log4j, Jackson (including BOMs),
Tomcat Embed, OpenTelemetry, Testcontainers, Byte Buddy, SLF4J, React Navigation,
React Native test tooling, and GitHub Actions.
Grouped patch updates automerge automatically after required CI checks pass and
the soak period elapses; grouped updates containing minor or major version releases
remain review-only. PostgreSQL container images are pinned to major version 18 to
prevent incompatible data volume upgrades. Renovate excludes only the named direct
Expo, React, React Native, and native test dependencies in `mobile/package.json`
(with `@types/react` aligned to React 19); it does not dynamically read Expo's SDK
compatibility matrix. Add native modules with `npx expo install <package>`. For an
Expo SDK upgrade, select the target `expo` version first, then run `npx expo install
--fix`, `npx expo install --check`, `npx expo-doctor`, and the mobile suites.

`.github/workflows/expo-maintenance.yml` owns routine Expo compatibility
updates. It runs daily (and supports manual `workflow_dispatch` with `dryRun`),
aligns the SDK-managed dependency set, verifies Expo's compatibility and project
health, pre-validates TypeScript (`lint`) and unit tests (`jest`), and creates or
refreshes one maintenance PR with an itemized package diff summary. It also
automatically closes obsolete maintenance PRs if the base branch is already
aligned. The normal mobile CI does not run `expo install --check`: Expo can
publish a new compatible patch without any change in a PR, so freshness is not a
stable per-PR gate. The maintenance PR still runs the required JavaScript,
Android, and iOS validations before merge.

The active `Protect main and require CI` ruleset protects `main`, requires
branches to be current, and requires these checks before GitHub auto-merge can
complete:

- `Backend`
- `Frontend`
- `End-to-End Tests`
- `Mobile JavaScript`
- `Android build and test`
- `iOS simulator build`

GitHub's platform automerge waits for every required check above. Docker image
builds and the hard Trivy image scan run in `ci.yml`, while secret scanning runs
in `gitleaks.yml`; neither is currently included in the active ruleset's
required-status-check list. Major, pin, digest, and lock-file-maintenance
updates remain reviewable PRs.

## 14. Reusable Building Blocks

Shared step logic lives in local composite actions under `.github/actions/`, so
the same implementation is not copied across workflows (and cannot drift):

- `npm-ci` — installs `shared/schemas` then a target package with `npm ci`
  (`package-path`, `shared-schemas`, `ignore-scripts` inputs).
- `start-backend` — generates disposable RSA keys, launches the JAR, and waits
  for `/actuator/health/liveness`, exposing the PID as an output.
- `prepull-buildkit` — pre-pulls the BuildKit image with bounded retries and
  configures `buildx` with `driver-opts: image=<image>` so the pre-pull and the
  builder cannot diverge.
- `upload-sarif` — uploads a SARIF file to Code Scanning under a stable category.

Callers reference them as `uses: ./.github/actions/<name>`. Job-level concerns
such as `permissions` and `services` remain in the calling job.

## 15. Troubleshooting

### `denied: permission_denied: write_package` during `docker push` (in `pushdockerimage.yml`)

- Confirm **Read and write permissions** is enabled under **Settings → Actions → General**.
- If the package already exists, link it to the repository as described above.
- Otherwise fall back to the `CR_PAT` secret method.
