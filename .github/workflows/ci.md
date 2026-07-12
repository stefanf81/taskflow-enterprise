# TaskFlow Enterprise CI/CD Documentation

This document explains the configuration of the `.github/workflows/ci.yml` file, detailing the state-of-the-art practices implemented, why they were chosen, and how each step contributes to a highly optimized, secure, and cost-effective CI/CD pipeline.

---

## 1. Trigger Configuration (`on`)
The workflow is triggered on pushes and pull requests to the `main` branch. 
It also includes a `workflow_dispatch` trigger with granular boolean inputs:
- `run_tests`: Toggles unit tests, integration tests, and Playwright E2E tests across both the frontend and backend.
- `run_security`: Toggles heavy dependency reviews and filesystem scans.
- `push_images`: Toggles whether compiled Docker images should be uploaded to the GitHub Container Registry (GHCR).
**Why:** This allows developers to manually trigger specific parts of the pipeline without wasting compute resources on steps they don't need to run at that exact moment.

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

- **Dynamic Task Sizing via `run_tests`:**
  If manually triggered with tests disabled, the build step dynamically skips `./gradlew test` and `jacocoTestReport` to speed up compile times, executing only the essential compiler packaging operations:
  ```bash
  TASKS="processAot assemble"
  if [ "${{ github.event_name != 'workflow_dispatch' || inputs.run_tests }}" = "true" ]; then
    TASKS="test processAot assemble jacocoTestReport"
  fi
  ./gradlew --parallel --build-cache $TASKS --stacktrace
  ```
- **Gradle Task Parallelism & Caching:** We explicitly pass the `--parallel` and `--build-cache` arguments to `./gradlew`. This compiles and processes independent AOT tasks across multiple threads, leveraging build outputs from previous runs.
- **Visual Test Reporting (`action-junit-report`)**: Parses XML test results and creates visual summaries in the GitHub UI.
- **Direct Artifact Uploads:** Instead of manually compressing reports into a `.tar.gz` archive, we upload the `build/reports` and `build/test-results` directories directly using `actions/upload-artifact@v7`. We set a 14-day retention period. For JAR files, we set `compression-level: 0` because they are already compressed natively.

## 7. Job: `frontend`
Handles the Angular 22 frontend linting, unit tests, and production distribution builds.

- **Secure NPM Caching (`actions/setup-node@v6`)**:
  Instead of caching the entire `node_modules` directory (which can lead to stale native binaries and cache poisoning risks), we rely on `setup-node`'s built-in `npm` cache. We always execute `npm ci` to ensure a clean, reproducible dependency tree.
- **Angular Build Caching:**
  We use `actions/cache` targeted directly at `frontend/.angular/cache`, keyed by the runner's OS and the `package-lock.json` hash. This stores compilation outputs across workflow runs and makes subsequent builds and tests significantly faster.
- **Bypassing Redundant Prettier Runs:**
  Rather than calling `npm run test` and `npm run build`, we call `npx ng test` and `npx ng build` directly. This prevents triggering the NPM pre-lifecycle hooks (`pretest`, `prebuild`) which otherwise run formatting checks multiple redundant times.
- **Conditional Testing:** The unit tests and coverage calculations are bypassed when `run_tests` is disabled on a manual trigger, skipping redundant unit execution.
- **Direct Coverage Artifacts:** We upload the test coverage reports directly using `actions/upload-artifact@v7` with a 14-day retention period, rather than manually compressing them into `.tar.gz` files.

## 8. Job: `security` (Unified Security Scan)
Consolidates and collapses the previously redundant backend and frontend security scanning jobs into a single highly optimized matrix-driven job.

- **Dynamic Matrix Execution:** Calculates a dynamic `security_components` array in the `changes` job based on which paths had modifications. If only frontend files changed, the backend filesystem scan is skipped; if only backend files changed, the frontend filesystem scan is skipped.
- **Deduplicated Dependency Review:** Runs the heavier GitHub `Dependency Review` action strictly on Pull Requests for the `Backend` matrix component, avoiding scanning the whole repository multiple times in separate jobs.
- **Centralized & Dynamic Trivy Database Cache:**
  Shares a single cache configuration for the Trivy database between both scans, drastically reducing setup overhead. To avoid stale cache issues when upgrading `aquasecurity/trivy-action`, the workflow **dynamically extracts the actual action version** directly from `.github/workflows/ci.yml` at runtime via regex (`grep`/`cut`) and injects it into the cache key. This ensures the cache is automatically invalidated whenever a developer upgrades the action version, eliminating hardcoded version mismatches.
- **Robust Failure Resiliency:** Utilizes the defensive fallback component `none` to avoid matrix compilation errors on PRs with only general/docs changes, and leverages `if: matrix.component.name != 'none' && always()` to guarantee that SARIF reports are uploaded even if the security scan fails.

## 9. Job: `e2e` (End-to-End Tests)
Runs Playwright E2E tests against a real, running backend and database.

- **Dual Dependency (`needs: [changes, backend, frontend]`)**:
  The E2E job now waits for both the backend and frontend jobs to succeed first. If unit tests fail, the heavy and expensive browser tests are skipped immediately, preventing pipeline resource waste.
- **Upgraded Playwright Browser Cache:** Playwright browsers are cached under a key tied directly to the `package-lock.json` file hash, guaranteeing that the cache is cleanly invalidated whenever the Playwright dependency version is modified. This also allowed us to remove the redundant `npx playwright --version` run step.
- **Targeted Browser Installation:** Instead of installing all available major browsers (Chromium, Firefox, WebKit), we only install `chromium` (`npx playwright install --with-deps chromium`), which matches the Desktop Chrome browser used in `playwright.config.ts`. This reduces dependency download sizes and drastically speeds up the installation phase.
- **Direct Playwright Reports Upload:** We upload `spring.log`, `frontend/playwright-report`, and `frontend/test-results` directly using the `upload-artifact` action. To save CPU cycles on already-compressed images and logs, we set `compression-level: 0` and apply a 14-day retention policy.

## 10. Job: `docker-build`
Compiles secure, production-grade container images for the backend and frontend components.

- **Dynamic Matrix Execution:** Instead of a hardcoded matrix that tries to build both components and fails when compilation is skipped, we use a dynamic `docker_components` output array calculated in the `changes` job. This only compiles and scans images that actually had changes.
- **Defensive Fallback Handling:** If no code components changed (e.g., only general documentation changed), the matrix falls back to `['none']` and all runner steps are safely bypassed using `if: matrix.component != 'none'` checks to avoid empty matrix errors.
- **Robust Security Scan Uploading:** Trivy security scanning uses `exit-code: 1` to fail on high or critical vulnerabilities. The final SARIF upload step utilizes `if: matrix.component != 'none' && always()` to ensure scan results are successfully uploaded to the GitHub Security tab even if vulnerabilities cause the scanning step to fail.
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
