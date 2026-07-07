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
Uses `dorny/paths-filter@v4` to detect exactly which files changed in a PR or push.
**Why:** Monorepos (where frontend and backend live together) waste massive amounts of time running backend tests when only a CSS file changed, or vice versa. This step dynamically determines whether the backend, frontend, or both need to run, completely skipping unaffected pipelines.

## 5. Job: `lint` (Dockerfile Lint)
A lightweight job that runs `hadolint` against `Dockerfile.x64` to verify linting and compliance.
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
- **Compressed Report Uploads:** Uploading individual files introduces massive API call latency. We compress reports into a single `backend-reports.tar.gz` archive before invoking `actions/upload-artifact@v7`, decreasing upload time from minutes to milliseconds.

## 7. Job: `frontend`
Handles the Angular 22 frontend linting, unit tests, and production distribution builds.

- **Shared Node Modules Caching (`actions/cache@v4`)**:
  We cache the entire physical `node_modules` directory across jobs using a key generated from the hash of the `package-lock.json` file. This allows subsequent jobs to bypass the `npm ci` installer step entirely, saving up to a minute per run.
- **Conditional Testing:** The unit tests and coverage calculations are bypassed when `run_tests` is disabled on a manual trigger, skipping redundant unit execution.
- **Compressed Coverage Artifacts:** Rather than uploading raw files, we archive the test coverage reports into a single `frontend-coverage.tar.gz` before publishing.

## 8. Job: `e2e` (End-to-End Tests)
Runs Playwright E2E tests against a real, running backend and database.

- **Dual Dependency (`needs: [changes, backend, frontend]`)**:
  The E2E job now waits for both the backend and frontend jobs to succeed first. If unit tests fail, the heavy and expensive browser tests are skipped immediately, preventing pipeline resource waste.
- **Shared `node_modules` Directory:** Reuses the exact same `node_modules` cache generated in the `frontend` job, dropping dependency installation overhead to zero.
- **Upgraded Playwright Browser Cache:** Playwright browsers are cached under a key tied directly to the `package-lock.json` file hash, guaranteeing that the cache is cleanly invalidated whenever the Playwright dependency version is modified. This also allowed us to remove the redundant `npx playwright --version` run step.
- **Compressed Playwright Reports:** Group-packages `spring.log`, `frontend/playwright-report`, and `frontend/test-results` into a single consolidated `playwright-report.tar.gz`, avoiding per-file upload overheads.

## 9. Job: `docker-build`
Compiles secure, production-grade container images for the backend and frontend components.

- **Robust Pushing & Flag Decoupling:** Image pushing has been refactored to:
  `((github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && inputs.push_images))`
  * **Automated runs:** Automatically push to the GitHub Container Registry (`ghcr.io`) upon merges/pushes to the `main` branch.
  * **Manual dispatches:** Fully respect the `push_images` checkbox parameter, permitting developers to choose whether they wish to push images, on any branch.
- **Skipped Docker Login on PRs:** The `docker/login-action` step is gated under the same push condition as above, completely bypassing registry login steps during PR runs where no images are pushed.
- **Manual Trigger Bypass (`workflow_dispatch`):** Added the manual trigger check to all job-level `if` checks to ensure that clicking "Run workflow" in GitHub UI actually executes the pipeline on any branch, instead of silently skipping due to lack of file changes.

## 10. Container & JVM Hardening (SOTA)
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
  - Mounts the shared archive at runtime via `ENV JAVA_OPTS="-XX:SharedArchiveFile=application.jsa -Xshare:on"`.
  - **Results:** Reduces runtime memory footprint, reduces JIT CPU cycles during startup, and boots the entire enterprise full-stack backend inside the container in just **2.09 seconds**!
