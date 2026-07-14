# TaskFlow Enterprise CI/CD Documentation

This document explains the configuration of the `.github/workflows/ci.yml` file, detailing the state-of-the-art practices implemented, why they were chosen, and how each step contributes to a highly optimized, secure, and cost-effective CI/CD pipeline.

---

## 1. Trigger Configuration (`on`)
The workflow is triggered on pushes and pull requests to the `main` branch. On Pull Requests, **all tests (backend compile and unit/integration tests, frontend unit tests, and Playwright End-to-End tests)** run automatically by default to catch any regressions early.

It also includes a `workflow_dispatch` trigger with granular boolean inputs for manual runs:
- `run_tests`: Toggles unit tests, integration tests, and Playwright E2E tests across both the frontend and backend on manual runs (default: true).
- `run_security`: Toggles heavy dependency reviews and filesystem scans (default: true).
- `push_images`: Toggles whether compiled Docker images should be uploaded to the GitHub Container Registry (GHCR) (default: false).
**Why:** This runs a comprehensive and rigorous set of quality gates on every Pull Request automatically, while offering fine-grained toggles for custom manual developer runs.

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

## 8. Job: `security` (Unified Security Scan)
Consolidates and collapses the previously redundant backend and frontend security scanning jobs into a single highly optimized matrix-driven job.

- **Dynamic Matrix Execution:** Calculates a dynamic `security_components` array in the `changes` job based on which paths had modifications. If only frontend files changed, the backend filesystem scan is skipped; if only backend files changed, the frontend filesystem scan is skipped.
- **Smart Job-Level Gating (Skip Optimization):** We applied a robust, job-level `if` conditional that checks path filters before a virtual runner VM is allocated. If a commit contains zero code changes (e.g. documentation-only pushes), GHA completely skips scheduling the job, saving substantial compute minutes and concurrent execution slots. We also completely eliminated the redundant `'none'` matrix fallback array.
- **Trivy CLI Version Synchronization:** Rather than relying purely on GHA action tags (which can drift from the underlying CLI binary), we explicitly define `TRIVY_VERSION: v0.70.0` globally and pass it to the scanner using `version: ${{ env.TRIVY_VERSION }}`. This aligns the local CLI installation, database cache keys, and engine version flawlessly, avoiding any HTTP 404 download crashes.
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
- **Upgraded Playwright Browser Cache:** Playwright browsers are cached under a key tied directly to the `package-lock.json` file hash, guaranteeing that the cache is cleanly invalidated whenever the Playwright dependency version is modified. This also allowed us to remove the redundant `npx playwright --version` run step.
- **Targeted Browser Installation:** Instead of installing all available major browsers (Chromium, Firefox, WebKit), we only install `chromium` (`npx playwright install --with-deps chromium`), which matches the Desktop Chrome browser used in `playwright.config.ts`. This reduces dependency download sizes and drastically speeds up the installation phase.
- **Direct Playwright Reports Upload:** We upload `spring.log`, `frontend/playwright-report`, and `frontend/test-results` directly using the `upload-artifact` action. To save CPU cycles on already-compressed images and logs, we set `compression-level: 0` and apply a 14-day retention policy.

## 9a. Job: `dast` (Dynamic Application Security Testing)
Runs automated OWASP ZAP API scans against a live, running instance of the backend.

- **Dynamic Environment Provisioning:** Similar to the `e2e` job, the `dast` job provisions high-speed **PostgreSQL 17** and **Redis** service containers on the runner to provide a fully clean integration environment.
- **Fast Startup via Artifact Reuse:** Instantly downloads the compiled `backend-jar` artifact, completely bypassing compile and assembly cycles.
- **Automated OWASP ZAP OpenAPI Scan:** Spins up the Spring Boot backend in the background and waits for the `/actuator/health` endpoint to be healthy. Then, it runs the official `zaproxy/action-api-scan@v0.9.0` container action to parse and fuzz all endpoints discovered in the OpenAPI schema (`/v3/api-docs`).
- **Interactive Security Reports:** Compiles and archives the standard ZAP `report_html.html` report along with the active `spring.log` as build artifacts (`zap-dast-report`) for simple analysis and resolution of identified warnings.
- **GitHub Security (GHAS) Code Scanning Integration:** Translates raw ZAP DAST findings into the standardized Static Analysis Results Interchange Format (SARIF) using a robust, in-repo Python conversion utility (`scripts/zap2sarif.py`). 
  - *URI Sanitization:* Standard SARIF converters preserve full absolute live endpoints (e.g. `http://localhost:8080/api/v1/auth`), which fail GitHub's ingestion validation with scheme mismatches (`SARIF URI scheme "http" did not match the checkout URI scheme "file"`). Our custom script robustly strips schemes and port overrides (transforming it to `localhost/api/v1/auth`), making the file immediately acceptable as a valid relative path within the checked-out codebase.
  - *Risk/Severity Mapping:* Maps ZAP's proprietary risk numbers to industry-standard threat levels (`error`, `warning`, `note`) and appends official CWE annotations (e.g. `external/cwe/cwe-XXX`) so the security findings render natively on the **GitHub Security → Code Scanning** dashboard.

## 10. Job: `docker-build`
Compiles secure, production-grade container images for the backend and frontend components.

- **Deduplicated Multi-Tag Builds:** Both the unique commit SHA (`IMAGE_TAG`) and `latest` tags are defined simultaneously in the `docker/build-push-action` step. This ensures Buildx executes a single build compilation graph, tagging the resulting local image under both tags at once.
- **Optimized Two-Stage Build-and-Push (SLSA & SBOM)**:
  To support local Trivy vulnerability scans, we must load the image into the local runner's daemon (`load: true`). However, GHA Buildx local loading does not support image index structures containing supply-chain annotations (SLSA provenance and SBOMs) and will crash. We solve this elegantly using a two-stage pattern:
  1.  **Stage 1 (Build Local & Scan):** Builds with `load: true`, `provenance: false`, and `sbom: false`. The image is scanned locally by Trivy (acting as a hard release gate).
  2.  **Stage 2 (Registry Push with Attestations):** When pushing to the registry, the manual `docker push` step is replaced with a second `build-push-action` utilizing `push: true`, `provenance: true`, and `sbom: true` (`provenance: true` registers SLSA metadata and `sbom: true` attaches SBOMs). Because Buildx pulls from the warm GHA cache populated during Stage 1, this push step executes **near-instantaneously** (under 5 seconds) without redundant compiling!
- **Dynamic Matrix Execution:** Instead of a hardcoded matrix that tries to build both components and fails when compilation is skipped, we use a dynamic `docker_components` output array calculated in the `changes` job. This only compiles and scans images that actually had changes.
- **Smart Job-Level Gating (Skip Optimization):** We applied a robust, job-level `if` conditional that checks path filters before a virtual runner VM is allocated. If a commit contains zero code changes (e.g. documentation-only pushes), GHA completely skips scheduling the job, saving substantial compute minutes and concurrent execution slots. We also completely eliminated the redundant `'none'` matrix fallback array.
- **Robust Security Scan Uploading:** Trivy security scanning uses `exit-code: 1` to fail on high or critical vulnerabilities. The final SARIF upload step utilizes `if: always()` to ensure scan results are successfully uploaded to the GitHub Security tab even if vulnerabilities cause the scanning step to fail.
- **Robust Pushing & Flag Decoupling:** Image pushing has been refactored to:
  `((github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && inputs.push_images))`
  * **Automated runs:** Automatically push to the GitHub Container Registry (`ghcr.io`) upon merges/pushes to the `main` branch.
  * **Manual dispatches:** Fully respect the `push_images` checkbox parameter, permitting developers to choose whether they wish to push images, on any branch.
- **Skipped Docker Login on PRs:** The `docker/login-action` step is gated under the same push condition as above, completely bypassing registry login steps during PR runs where no images are pushed.
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
