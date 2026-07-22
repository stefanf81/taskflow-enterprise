# TaskFlow Enterprise CI/CD Documentation

This document explains the configuration of the `.github/workflows/ci.yml` file, detailing the state-of-the-art practices implemented, why they were chosen, and how each step contributes to a highly optimized, secure, and cost-effective CI/CD pipeline.

---

## 1. Trigger Configuration (`on`)
The workflow is triggered on pushes and pull requests to the `main` branch. On Pull Requests, available test jobs are gated by path filtering (see below) — the backend test suite and frontend unit tests run when their respective stacks changed, and Playwright E2E runs when **both** stacks changed.

It also includes a `workflow_dispatch` trigger with a boolean input for manual runs:
- `run_tests`: Toggles unit tests, integration tests, and Playwright E2E tests across both the frontend and backend on manual runs (default: true).

A daily **schedule** (`0 2 * * *`) runs the full build, test, and Docker build+scan pipeline as a nightly regression suite. Security-only scans (CodeQL, Trivy filesystem) are handled by the separate `.github/workflows/security.yml` workflow (staggered to the same 02:00 UTC window).

> **Gating behavior on PRs honors path filtering.** Single-stack PRs (frontend-only or backend-only) skip the jobs of the untouched stack. Playwright E2E tests run on a PR **only when both `backend` and `frontend` actually built** — i.e. dual-stack PRs — because E2E consumes both build artifacts. Unit/integration tests run on PRs, on direct pushes to `main`, on the daily schedule, and on manual `workflow_dispatch` runs with `run_tests: true`.

**Why:** This runs a comprehensive and rigorous set of quality gates on every PR (subject to the path-filtering rules above), while offering fine-grained toggles for custom manual developer runs.

## 2. Concurrency (`concurrency`)
```yaml
concurrency:
  group: taskflow-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```
**Why:** If a developer pushes multiple commits to a PR in rapid succession, GitHub Actions will cancel the older, now-obsolete pipeline runs. This saves significant compute minutes and prevents a queue of stale builds.

## 3. Least-Privilege Permissions (`permissions`)
The top-level permissions block grants the absolute minimum access required. Specific jobs override these with only what they need (e.g., `packages: write` for Docker pushing, `security-events: write` for SARIF uploads).
**Why:** Adheres to the Zero-Trust security model. If a malicious dependency somehow compromises the runner, the blast radius is severely limited because the `GITHUB_TOKEN` lacks sweeping repository write access.

## 4. Job: `changes` (Path Filtering)
Uses `dorny/paths-filter@v4` to detect exactly which files changed in a PR or push. We enforce a 5-minute timeout on this job to prevent it from stalling.
We have split the filters further to include `docker_backend` and `docker_frontend` and added a shell script to dynamically output a JSON array of changed components (`docker_components`).
**Why:** Monorepos (where frontend and backend live together) waste massive amounts of time running backend tests when only a CSS file changed, or vice versa. This step dynamically determines whether the backend, frontend, or both need to run (and similarly, which Docker images actually need to be built), completely skipping unaffected pipelines and avoiding missing build artifact failures.

## 5. Job: `lint` (Dockerfile Lint)
A lightweight job that runs `hadolint` against `Dockerfile.x64` and `frontend/Dockerfile` to verify linting and compliance. It only runs if Docker-related files were changed.
**Why:** Fails fast. By running these checks early and separately, we don't waste 5 minutes booting up JVMs and Node environments just to tell a developer they missed a Dockerfile best practice.

## 6. Job: `backend`
This job handles the Spring Boot backend compilation, testing, and packaging.

- **Automatic & Conditional Test Execution:**
  Unit and integration tests run automatically on all Pull Requests. On manual runs (`workflow_dispatch`), they are executed conditionally if `run_tests` is enabled, or skipped entirely to fast-track packaging.
- **Gradle Task Parallelism & Caching:** We explicitly pass the `--parallel` and `--build-cache` arguments to `./gradlew`. This compiles independent modules across multiple threads, leveraging build outputs from previous runs.
- **Gradle Caching Write Access (`cache-read-only: false`):** We configure `cache-read-only: false` on the setup-gradle action. By default, setup-gradle disables cache writes on non-default branches (e.g. Pull Requests). Overriding this ensures that PR branches can cache new/updated dependencies, avoiding slow downloads on subsequent commits.
- **Visual Test Reporting (`action-junit-report`)**: Parses XML test results and creates visual summaries in the GitHub UI.
- **Direct Artifact Uploads:** Instead of manually compressing reports into a `.tar.gz` archive, we upload the `build/reports` and `build/test-results` directories directly using `actions/upload-artifact@v7`. We set a 14-day retention period. For JAR files, we set `compression-level: 0` because they are already compressed natively.

## 7. Job: `frontend`
Handles the Angular 22 frontend linting, unit tests, and production distribution builds.

- **Built-in Global NPM Cache (`actions/setup-node@v6`)**:
  Leverages the native `cache: npm` and `cache-dependency-path: frontend/package-lock.json` properties of the `setup-node` action. This reduces manual configuration boilerplate, manages branch-scoped cache restoration automatically before any installations occur, and removes general maintenance overhead.
- **Angular Build Caching:**
  We use `actions/cache` targeted directly at `frontend/.angular/cache`, keyed by the runner's OS and the `package-lock.json` hash. This stores compilation outputs across workflow runs and makes subsequent builds and tests significantly faster.
- **Bypassing Redundant Prettier Runs:**
  Rather than calling `npm run test` and `npm run build`, we call `npx ng test` and `npx ng build` directly. This prevents triggering the NPM pre-lifecycle hooks (`pretest`, `prebuild`) which otherwise run formatting checks multiple redundant times.
- **Conditional Testing:** Unit tests and coverage outputs run automatically by default on every Pull Request, and can be bypassed on manual triggers if `run_tests` is disabled.
- **Direct Coverage Artifacts:** We upload the test coverage reports directly using `actions/upload-artifact@v7` with a 14-day retention period, rather than manually compressing them into `.tar.gz` files.

## 7a. Job: `dependency-submission` (Dependency Graph Submission)
Submits the complete, deep Java and Gradle dependency tree directly to the GitHub Dependency Submission API.

- **Dependabot Integration:** Uses `gradle/actions/dependency-submission@v6` to extract, compile, and upload the full transitive dependency graph on pushes to the `main` branch. This empowers Dependabot to dynamically track package vulnerabilities and automatically generate hotfix pull requests the moment a CVE is disclosed.
- **Caching & Permissions:** Explicitly configured with `contents: write` and `actions: write` permissions. The `actions: write` permission is crucial to allow the Gradle Action to save and restore dependencies caching successfully, preventing "cache write denied" warnings while maximizing the build execution speed on subsequent runs.

## 8. Job: `security` — moved to `security.yml`

> The Trivy filesystem scan and Dependency Review have been extracted to a dedicated nightly workflow, [`.github/workflows/security.yml`](security.yml). This keeps the CI/CD pipeline focused on build, test, and deployment, while security-only scans run independently on the nightly schedule (and on demand via `workflow_dispatch`).

See [`security.yml`](security.yml) for details on:
- **Trivy Filesystem Scan:** Report-only (`exit-code: 0`) SARIF upload for both Backend (`.`) and Frontend (`frontend/`) source trees, surfaced in the Code Scanning tab. Severity asymmetry vs. the Docker image hard gate is deliberately maintained — see the inline notes.
- **Trivy Database Caching:** Weekly cache key scoped to `TRIVY_VERSION`.

## 8a. Job: `codeql` — moved to `security.yml`

> CodeQL analysis (Java + JavaScript) has also been extracted to `.github/workflows/security.yml`.

Runs deep semantic security analysis in parallel for both languages on every nightly run:

- **Java (`build-mode: autobuild`):** CodeQL performs its own Gradle build tracking — it does not consume the production JAR from the `backend` job, so there is no serialization bottleneck.
- **JavaScript (`build-mode: none`):** Scans the Angular 22 TypeScript source without building, keeping the analysis lightweight.

The standalone workflow has no change-detection dependency — it always scans both languages on every scheduled/manual run.

## 9. Job: `e2e` (End-to-End Tests)
Runs Playwright E2E tests against a real, running backend and database.

- **Decoupled dependencies (`needs: [changes, backend, frontend]`)**:
  The E2E job depends strictly on `changes`, `backend`, and `frontend`. This eliminates redundant bottlenecks (E2E tests don't have to wait for static analysis) and completely prevents skip-cascading.
- **Dual-Stack PR Gating:** On Pull Requests, E2E runs **only when both `backend` and `frontend` actually built** — i.e. when the PR touched both stacks. The `if` excludes `skipped` results so a single-stack PR (which skips one of the two build jobs via path filtering) cleanly skips E2E rather than running with a missing artifact. On direct pushes to `main`, the daily schedule, and manual `workflow_dispatch` runs with `run_tests: true`, E2E unconditionally runs (both stacks always build in those cases).
- **Upgraded Playwright Browser Cache:** Playwright browsers are cached under a key tied directly to the `package-lock.json` file hash, guaranteeing that the cache is cleanly invalidated whenever the Playwright dependency version is modified. This also allowed us to remove the redundant `npx playwright --version` run step.
- **Targeted Browser Installation:** Instead of installing all available major browsers (Chromium, Firefox, WebKit), we only install `chromium` (`npx playwright install --with-deps chromium`), which matches the Desktop Chrome browser used in `playwright.config.ts`. This reduces dependency download sizes and drastically speeds up the installation phase.
- **Direct Playwright Reports Upload:** We upload `spring.log`, `frontend/playwright-report`, and `frontend/test-results` directly using the `upload-artifact` action. To save CPU cycles on already-compressed images and logs, we set `compression-level: 0` and apply a 14-day retention policy.

## 9a. DAST (Dynamic Application Security Testing) — see `dast.yml`

> The OWASP ZAP scan lives in its own dedicated workflow file, [`dast.yml`](dast.yml), and is no longer embedded in `ci.yml`. It is triggered on the daily schedule (staggered to **02:30 UTC**, off the 02:00 herd) and via manual `workflow_dispatch`.

Runs an automated OWASP ZAP **full scan** against a live, running instance of the backend.

- **Dynamic Environment Provisioning:** Provisions high-speed **PostgreSQL 18.4** and **Redis** service containers on the runner to provide a fully clean integration environment.
- **Standalone Build:** Builds the backend with `./gradlew bootJar` (matching the production artifact) and boots it with `SPRING_PROFILES_ACTIVE=prod`, then waits for the `/actuator/health/liveness` endpoint to be healthy before scanning.
- **OWASP ZAP Full Scan:** Uses `zaproxy/action-full-scan@v0.13.0` against `http://localhost:8080` with `fail_action: true`, covering the full web surface (not just the OpenAPI schema) of the running application.
- **Interactive Security Reports:** Archives `report_html.html`, `report_json.json`, `report_md.md`, and `spring.log` as the `zap-full-scan` artifact (30-day retention).
- **GitHub Security (GHAS) Code Scanning Integration:** Translates raw ZAP DAST findings into SARIF via the in-repo conversion utility `scripts/zap2sarif.py` and uploads them under the `dast-zap` category so they render natively on the **GitHub Security → Code Scanning** dashboard. The `upload-sarif` step uses `continue-on-error: true` so a SARIF ingestion failure never masks the scan results artifact.

## 10. Job: `docker-build`
Compiles secure, production-grade container images for the backend and frontend components.

> **Image publication is intentionally excluded from CI.** Docker images are built and scanned locally in CI but never pushed to GHCR. Publication is an explicit operator action via the dedicated [`.github/workflows/pushdockerimage.yml`](pushdockerimage.yml) workflow — see that file for the push pipeline.

- **Deduplicated Multi-Tag Builds:** Both the unique commit SHA (`IMAGE_TAG`) and `latest` tags are defined simultaneously in the `docker/build-push-action` step. This ensures Buildx executes a single build compilation graph, tagging the resulting local image under both tags at once.
- **Lowercase GHCR Owner Guard:** GHCR rejects mixed/uppercase repository owners (`repository name must be lowercase`). A `Compute Image Refs` step lowercases `github.repository_owner` once and exhales fully-resolved `ghcr.io/<owner>/taskflow-{backend,frontend}` refs as step outputs, which `build-push-action` and the Trivy `image-ref` both consume. This prevents hard-failures for forks/orgs whose casing doesn't match the package's lowercase requirement.
- **Local Load Only:** Images are built with `load: true`, `push: false`, `provenance: false`, `sbom: false`. GHA Buildx local loading does not support image index structures containing supply-chain annotations, so attestations are omitted. The `pushdockerimage.yml` workflow rebuilds with `provenance: true` / `sbom: true` when publishing.
- **Dynamic Matrix Execution:** Instead of a hardcoded matrix that tries to build both components and fails when compilation is skipped, we use a dynamic `docker_components` output array calculated in the `changes` job. This only compiles and scans images that actually had changes.
- **Smart Job-Level Gating (Skip Optimization):** We applied a robust, job-level `if` conditional that checks path filters before a virtual runner VM is allocated. If a commit contains zero code changes (e.g. documentation-only pushes), GHA completely skips scheduling the job, saving substantial compute minutes and concurrent execution slots. We also completely eliminated the redundant `'none'` matrix fallback array.
- **Hard-Gate Trivy Scan:** The image is scanned with `exit-code: 1` and `severity: HIGH,CRITICAL` — a blocking gate. This is the intentional counterpart to the report-only Trivy filesystem scan in `security.yml`. If a high/critical CVE is found, the build fails but the SARIF is still uploaded (via `if: always()`).
- **GHA Cache for BuildKit:** The `cache-from` / `cache-to` directives use GitHub Actions cache (`type=gha`) with scoped keys per component and branch, so PR builds reuse layers from `main` when possible.
- **Manual Trigger Bypass (`workflow_dispatch`):** Added the manual trigger check to all job-level `if` checks to ensure that clicking "Run workflow" in GitHub UI actually executes the pipeline on any branch, instead of silently skipping due to lack of file changes.

## 11. Container & JVM Hardening (SOTA)
Our Docker build configurations (`Dockerfile` and `Dockerfile.x64`) implement state-of-the-art container optimization techniques:
- **BuildKit Cache Mounts:** Utilizes `--mount=type=cache,target=/tmp` on the Spring Boot layer extraction step, allowing BuildKit to store temporary compilation metadata across iterations.
- **COPY --link:** Copies multi-stage compiled artifacts using independent image layers, bypassing full filesystem rewrites and facilitating immediate image layer linking.
- **JVM Class Data Sharing (CDS / AppCDS):**
  - Executes a headless training run during the `docker build` process:
    ```dockerfile
    RUN java -XX:ArchiveClassesAtExit=application.jsa \
             -Dspring.context.exit=onRefresh \
             -Dspring.flyway.enabled=false \
             -Dspring.jpa.hibernate.ddl-auto=none \
             org.springframework.boot.loader.launch.JarLauncher \
        && chown 10001:10001 application.jsa
    ```
  - Saves pre-linked and pre-parsed JVM class-data to `/app/application.jsa`, owned by our non-root UID.
  - Mounts the shared archive at runtime via native `CMD` arguments `"-XX:SharedArchiveFile=application.jsa" "-Xshare:on"`.
  - **Results:** Reduces runtime memory footprint, reduces JIT CPU cycles during startup, and boots the entire enterprise full-stack backend inside the container in just **2.09 seconds**!

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

> For the equivalent Jenkins pipeline, see [`JENKINS.md`](../JENKINS.md).

## 13. Troubleshooting

### `denied: permission_denied: write_package` during `docker push` (in `pushdockerimage.yml`)
- Confirm **Read and write permissions** is enabled under **Settings → Actions → General**.
- If the package already exists, link it to the repository as described above.
- Otherwise fall back to the `CR_PAT` secret method.
