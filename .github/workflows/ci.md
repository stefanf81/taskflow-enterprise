# TaskFlow Enterprise CI/CD Documentation

This document explains the configuration of the `.github/workflows/ci.yml` file, detailing the state-of-the-art practices implemented, why they were chosen, and how each step contributes to a highly optimized, secure, and cost-effective CI/CD pipeline.

---

## 1. Trigger Configuration (`on`)
The workflow is triggered on pushes and pull requests to the `main` branch. On Pull Requests, available test jobs are gated by path filtering (see below) — the backend test suite and frontend unit tests run when their respective stacks changed, and Playwright E2E runs when **both** stacks changed.

It also includes a `workflow_dispatch` trigger with granular boolean inputs for manual runs:
- `run_tests`: Toggles unit tests, integration tests, and Playwright E2E tests across both the frontend and backend on manual runs (default: true).
- `run_security`: Toggles heavy dependency reviews and filesystem scans (default: true).
- `push_images`: Toggles whether compiled Docker images should be uploaded to the GitHub Container Registry (GHCR) (default: false).

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
- **Gradle Task Parallelism & Caching:** We explicitly pass the `--parallel` and `--build-cache` arguments to `./gradlew`. This compiles and processes independent AOT tasks across multiple threads, leveraging build outputs from previous runs.
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

## 8. Job: `security` (Unified Security Scan)
Consolidates and collapses the previously redundant backend and frontend security scanning jobs into a single highly optimized matrix-driven job.

- **Dynamic Matrix Execution:** Calculates a dynamic `security_components` array in the `changes` job based on which paths had modifications. If only frontend files changed, the backend filesystem scan is skipped; if only backend files changed, the frontend filesystem scan is skipped.
- **Smart Job-Level Gating (Skip Optimization):** We applied a robust, job-level `if` conditional that checks path filters before a virtual runner VM is allocated. If a commit contains zero code changes (e.g. documentation-only pushes), GHA completely skips scheduling the job, saving substantial compute minutes and concurrent execution slots. We also completely eliminated the redundant `'none'` matrix fallback array.
- **Trivy CLI Version Synchronization:** Rather than relying purely on GHA action tags (which can drift from the underlying CLI binary), we explicitly define `TRIVY_VERSION: v0.72.0` globally and pass it to the scanner using `version: ${{ env.TRIVY_VERSION }}`. This aligns the local CLI installation, database cache keys, and engine version flawlessly, avoiding any HTTP 404 download crashes.
- **Expanded, Runs-Exactly-Once Dependency Review:** Runs the heavier GitHub `Dependency Review` action strictly on Pull Requests exactly once per run. It executes on the `Backend` loop, or falls back to the `Frontend` loop strictly if no backend changes are present in the PR, guaranteeing 100% scanning coverage of Angular NPM lockfile updates without redundant execution overhead.
- **Centralized & Robust Trivy Database Cache:**
  Shares a single cache configuration for the Trivy database between both scans, drastically reducing setup overhead. The cache key is bound to `TRIVY_VERSION`, ensuring the database is automatically and cleanly invalidated whenever the Trivy version is upgraded.

## 8a. Job: `codeql` (Parallelized CodeQL Analysis)
Performs deep semantic security analysis of the codebase.

- **Parallelized Critical Path:** The `codeql` job depends strictly on the `changes` step, running in parallel with the main `backend` and `frontend` compilation steps rather than being serialized behind them. Since CodeQL performs its own build tracking (autobuild/traced-build) and does not consume the production JARs or Web bundles, letting it run in parallel reduces the overall workflow critical path duration significantly.

## 9. Job: `e2e` (End-to-End Tests)
Runs Playwright E2E tests against a real, running backend and database.

- **Decoupled dependencies (`needs: [changes, backend, frontend]`)**:
  The E2E job depends strictly on `changes`, `backend`, and `frontend` (not `codeql` or `security`). This eliminates redundant bottlenecks (E2E tests don't have to wait for static CodeQL analysis) and completely prevents skip-cascading. If the `security` job is skipped on clean commits, GHA will no longer bypass E2E tests, allowing them to run reliably on every merge or push.
- **Dual-Stack PR Gating:** On Pull Requests, E2E runs **only when both `backend` and `frontend` actually built** — i.e. when the PR touched both stacks. The `if` excludes `skipped` results so a single-stack PR (which skips one of the two build jobs via path filtering) cleanly skips E2E rather than running with a missing artifact. On direct pushes to `main`, the daily schedule, and manual `workflow_dispatch` runs with `run_tests: true`, E2E unconditionally runs (both stacks always build in those cases).
- **Upgraded Playwright Browser Cache:** Playwright browsers are cached under a key tied directly to the `package-lock.json` file hash, guaranteeing that the cache is cleanly invalidated whenever the Playwright dependency version is modified. This also allowed us to remove the redundant `npx playwright --version` run step.
- **Targeted Browser Installation:** Instead of installing all available major browsers (Chromium, Firefox, WebKit), we only install `chromium` (`npx playwright install --with-deps chromium`), which matches the Desktop Chrome browser used in `playwright.config.ts`. This reduces dependency download sizes and drastically speeds up the installation phase.
- **Direct Playwright Reports Upload:** We upload `spring.log`, `frontend/playwright-report`, and `frontend/test-results` directly using the `upload-artifact` action. To save CPU cycles on already-compressed images and logs, we set `compression-level: 0` and apply a 14-day retention policy.

## 9a. DAST (Dynamic Application Security Testing) — see `dast.yml`

> The OWASP ZAP scan lives in its own dedicated workflow file, [`dast.yml`](dast.yml), and is no longer embedded in `ci.yml`. It is triggered on the daily schedule (staggered to **02:30 UTC**, off the 02:00 herd) and via manual `workflow_dispatch`.

Runs an automated OWASP ZAP **full scan** against a live, running instance of the backend.

- **Dynamic Environment Provisioning:** Provisions high-speed **PostgreSQL 17** and **Redis** service containers on the runner to provide a fully clean integration environment.
- **Standalone Build:** Builds the backend with `./gradlew bootJar` and boots it with `SPRING_PROFILES_ACTIVE=prod`, then waits for the `/actuator/health/liveness` endpoint to be healthy before scanning.
- **OWASP ZAP Full Scan:** Uses `zaproxy/action-full-scan@v0.13.0` against `http://localhost:8080` with `fail_action: true`, covering the full web surface (not just the OpenAPI schema) of the running application.
- **Interactive Security Reports:** Archives `report_html.html`, `report_json.json`, `report_md.md`, and `spring.log` as the `zap-full-scan` artifact (30-day retention).
- **GitHub Security (GHAS) Code Scanning Integration:** Translates raw ZAP DAST findings into SARIF via the in-repo conversion utility `scripts/zap2sarif.py` and uploads them under the `dast-zap` category so they render natively on the **GitHub Security → Code Scanning** dashboard. The `upload-sarif` step uses `continue-on-error: true` so a SARIF ingestion failure never masks the scan results artifact.

## 10. Job: `docker-build`
Compiles secure, production-grade container images for the backend and frontend components.

- **Deduplicated Multi-Tag Builds:** Both the unique commit SHA (`IMAGE_TAG`) and `latest` tags are defined simultaneously in the `docker/build-push-action` step. This ensures Buildx executes a single build compilation graph, tagging the resulting local image under both tags at once.
- **Lowercase GHCR Owner Guard:** GHCR rejects mixed/uppercase repository owners (`repository name must be lowercase`). A `Compute Image Refs` step lowercases `github.repository_owner` once and exhales fully-resolved `ghcr.io/<owner>/taskflow-{backend,frontend}` refs as step outputs, which `build-push-action` and the Trivy `image-ref` both consume. This prevents hard-failures for forks/orgs whose casing doesn't match the package's lowercase requirement.
- **Single-Stage Build-and-Push with Conditional Attestations:**
  To support local Trivy vulnerability scans, we must load the image into the local runner's daemon (`load: true`). However, GHA Buildx local loading does not support image index structures containing supply-chain annotations (SLSA provenance and SBOMs) and will crash. We solve this with a single `docker/build-push-action` call whose `push`/`load`/`provenance`/`sbom` flags are driven by one expression:
  - When **not** pushing (`push: false`, `load: true`) — the default on PRs, pushes to `main`, and schedule — the image is loaded into the local daemon with `provenance: false` and `sbom: false` so Trivy can scan it as a hard release gate.
  - When pushing (`push: true`, `load: false`, `provenance: true`, `sbom: true`) — only on manual `workflow_dispatch` with `push_images: true` — Buildx reuses the warm GHA cache from the local build and emits the registry artifact with SLSA provenance and SBOM attached.
  This avoids the redundant second build graph of a two-stage pattern while still keeping attestations on pushed images.
- **Dynamic Matrix Execution:** Instead of a hardcoded matrix that tries to build both components and fails when compilation is skipped, we use a dynamic `docker_components` output array calculated in the `changes` job. This only compiles and scans images that actually had changes.
- **Smart Job-Level Gating (Skip Optimization):** We applied a robust, job-level `if` conditional that checks path filters before a virtual runner VM is allocated. If a commit contains zero code changes (e.g. documentation-only pushes), GHA completely skips scheduling the job, saving substantial compute minutes and concurrent execution slots. We also completely eliminated the redundant `'none'` matrix fallback array.
- **Robust Security Scan Uploading:** Trivy security scanning uses `exit-code: 1` to fail on high or critical vulnerabilities. The final SARIF upload step utilizes `if: always()` to ensure scan results are successfully uploaded to the GitHub Security tab even if vulnerabilities cause the scanning step to fail.
- **Manual-Only Image Pushing (No Auto-Push on `main`):** Image pushing is intentionally gated behind manual `workflow_dispatch` only:
  ```yaml
  push: ${{ github.event_name == 'workflow_dispatch' && inputs.push_images == true }}
  load: ${{ !(github.event_name == 'workflow_dispatch' && inputs.push_images == true) }}
  ```
  * **Automated runs (push to `main`, schedule):** Build **and Trivy-scan** the images locally (`load: true`) but do **not** publish them. The k3d pipeline builds images locally for deploy, so publishing to GHCR is not required on every merge.
  * **Manual dispatches:** Fully respect the `push_images` checkbox parameter, permitting developers to choose whether they wish to push images, on any branch.
- **Skipped Docker Login When Not Pushing:** The `docker/login-action` step is gated under the same push condition as above, completely bypassing registry login steps during PR and `main` runs where no images are pushed.
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

The workflow pushes images to the GitHub Container Registry (GHCR) using the default `GITHUB_TOKEN`.

### Workflow permissions
1. Repository **Settings → Actions → General**.
2. Under **Workflow permissions**, select **Read and write permissions** (required so the token can push packages and write security events).
3. Click **Save**.

### Linking packages to the repository (if they already exist)
If you previously pushed `taskflow-backend` / `taskflow-frontend` manually (e.g. via a PAT), those packages are owned by your profile rather than the repository token:
1. On your GitHub profile, open **Packages → taskflow-backend** (and `taskflow-frontend`).
2. **Package settings → Manage Actions access → Add repository**, select this repository, and grant **Write**.

### Personal Access Token fallback (`CR_PAT`)
If organization policy blocks workflow write permissions, create a classic PAT with `write:packages` (and optionally `delete:packages`) and store it as a repository secret named `CR_PAT`. Then change the `docker/login-action` step in `ci.yml` to use `password: ${{ secrets.CR_PAT }}`.

> For the equivalent Jenkins pipeline, see [`JENKINS.md`](../JENKINS.md).

## 13. Troubleshooting

### `denied: permission_denied: write_package` during `docker push`
- Confirm **Read and write permissions** is enabled under **Settings → Actions → General**.
- If the package already exists, link it to the repository as described above.
- Otherwise fall back to the `CR_PAT` secret method.
