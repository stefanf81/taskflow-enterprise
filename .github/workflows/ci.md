# TaskFlow Enterprise CI/CD Documentation

This document explains the configuration of the `.github/workflows/ci.yml` file, detailing the state-of-the-art practices implemented, why they were chosen, and how each step contributes to a highly optimized, secure, and cost-effective CI/CD pipeline.

---

## 1. Trigger Configuration (`on`)
The workflow is triggered on pushes and pull requests to the `main` branch. 
It also includes a `workflow_dispatch` trigger with granular boolean inputs:
- `run_lint_and_format`: Toggles quick static checks.
- `run_tests`: Toggles heavy compilation and test execution.
- `run_security_scans`: Toggles container vulnerability scanning.
**Why:** This allows developers to manually trigger specific parts of the pipeline without wasting compute resources on steps they don't need to run at that exact moment.

## 2. Concurrency (`concurrency`)
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```
**Why:** If a developer pushes multiple commits to a PR in rapid succession, GitHub Actions will cancel the older, now-obsolete pipeline runs. This saves significant compute minutes and prevents a queue of stale builds.

## 3. Least-Privilege Permissions (`permissions`)
The top-level permissions block grants the absolute minimum access required. Specific jobs override these with only what they need (e.g., `packages: write` for Docker pushing, `security-events: write` for SARIF uploads).
**Why:** Adheres to the Zero-Trust security model. If a malicious dependency somehow compromises the runner, the blast radius is severely limited because the `GITHUB_TOKEN` lacks sweeping repository write access.

## 4. Job: `changes` (Path Filtering)
Uses `dorny/paths-filter@v4` to detect exactly which files changed in a PR or push.
**Why:** Monorepos (where frontend and backend live together) waste massive amounts of time running backend tests when only a CSS file changed, or vice versa. This step dynamically determines whether the backend, frontend, or both need to run, completely skipping unaffected pipelines.

## 5. Job: `lint-and-format`
A lightweight job that runs `hadolint` against all Dockerfiles and `prettier` against the frontend codebase.
**Why:** Fails fast. By running these checks early and separately, we don't waste 5 minutes booting up JVMs and Node environments just to tell a developer they missed a semicolon or a Dockerfile best practice.

## 6. Job: `codeql-analysis` (SAST)
Uses GitHub's native CodeQL engine across a matrix strategy (`java` and `javascript`).
**Why:** CodeQL is the industry standard for Static Application Security Testing (SAST). It detects deep code-level vulnerabilities (like SQL injection or XSS) directly in the source code. The `security-extended,security-and-quality` queries ensure we catch both security flaws and maintainability issues.
- **Build Mode None:** For Java, we utilize CodeQL's newer `build-mode: none` functionality. This analyzes the Java codebase without needing to intercept a clean compilation process, saving ~1 minute of redundant compilation overhead in the security scanning pipeline.

## 7. Job: `backend-pipeline`
This job handles the Spring Boot backend compilation, testing, and containerization.

- **Gradle Build Cache (`setup-gradle@v4`)**: Caches Gradle dependencies and build outputs.
- **Optimized Test Command**: `./gradlew check --no-daemon --parallel --build-cache`. 
  - **Why:** We removed the `clean` task. Running `clean` destroys the local cache. By utilizing Gradle's build cache and parallel execution, incremental test runs are exponentially faster.
- **Visual Test Reporting (`action-junit-report`)**: Parses XML test results and creates visual summaries in the GitHub UI.
  - **Why:** Developers no longer need to download zip artifacts and dig through text logs to find which test failed.
- **Docker BuildKit Caching (`cache-from/cache-to`)**:
  - **Why:** Injects GitHub Actions' native caching directly into Docker Buildx. Unchanged Docker layers (like downloaded dependencies) are instantly pulled from cache rather than rebuilt.
- **Trivy SARIF Upload**: 
  - **Why:** Instead of printing vulnerabilities to a console log, Trivy generates a `.sarif` file which is uploaded to GitHub's native **Security > Code scanning alerts** tab for proper tracking and lifecycle management.

## 8. Job: `frontend-pipeline`
Handles the Angular 22 frontend build, testing, Playwright E2E execution, and containerization.

- **Playwright Browser Caching**:
  - Dynamically extracts the Playwright version and caches the `~/.cache/ms-playwright` directory based on the OS and version.
  - **Why:** Downloading hundreds of megabytes of headless browsers (Chromium, Firefox, WebKit) on every PR takes minutes. We conditionally run `npx playwright install-deps` (to get OS libraries) if the cache hits, completely bypassing the massive browser binary download.
- **Embedded Spring Boot for Full-Stack E2E:** 
  - Automatically spins up the Java Spring Boot backend (`./gradlew bootRun`) in the background of the frontend runner, waiting for its health check to become green before running Playwright.
  - **Why:** The Angular application's E2E suite performs actual full-stack tasks (creating guest bookings, logging in as admin, approving bookings). Running Playwright tests without a running backend results in `504 Gateway Timeout` or connection errors. We also upload `spring-boot.log` as a workflow artifact upon failure to provide holistic backend+frontend debugging!
- **E2E Artifact Uploads**: Uploads the `playwright-report/` upon completion.
  - **Why:** If an E2E test fails, developers can download the HTML report and traces to visually debug what went wrong in the browser.
- **FinOps Artifact Retention (`retention-days: 7`)**:
  - **Why:** Applied to all `upload-artifact` steps (test results, jacoco, playwright). GitHub defaults to 90 days of retention, which rapidly consumes storage quotas. Test reports are generally useless after a few days, so a 7-day retention heavily optimizes cloud storage costs.

## 9. Code Cleanliness & Syntax Optimizations
The workflow script itself has been thoroughly refactored for readability and maintenance:
- **Simplified Boolean Evaluations:** We removed overly verbose expressions like `${{ inputs.run_tests == true || inputs.run_tests == 'true' }}`. GitHub Actions natively interprets boolean input types, so conditions are now cleanly written as `if: github.event_name != 'workflow_dispatch' || inputs.run_tests`.
- **Strict Least-Privilege Permissions:** The global `permissions:` block at the top of the file has been restricted solely to `contents: read`. Any job that needs more power (like pushing Docker images or creating PR comments) explicitly declares its own elevated `permissions` block. This prevents any newly added, misconfigured jobs from unintentionally inheriting global write access.
## 10. Ultimate Performance Bottleneck Optimizations
To further squeeze every last second of performance out of the pipeline, three major bottlenecks were resolved:
- **Consolidated Node Environments:** Previously, the `lint-and-format` job spun up a complete Node.js environment just to run Prettier, while `frontend-pipeline` did the same for Angular tests. Prettier has been moved directly into the `frontend-pipeline` immediately after `npm ci`. This eliminates an entirely redundant `actions/setup-node` and `npm ci` initialization! `lint-and-format` is now purely for Dockerfile linting (`lint-dockerfiles`).
- **Scoped Docker Caching for Monorepos:** Because `frontend-pipeline` and `backend-pipeline` run in parallel, using standard `cache-from: type=gha` causes their BuildKit caches to overwrite each other. We applied `scope=backend` and `scope=frontend` to securely isolate their caching layers.
- **Docker Layer Caching Optimization:** We removed `--mount=type=cache` from the `Dockerfile.x64` Gradle dependency download step. While buildkit cache mounts are great for local builds, they are *ephemeral* in GitHub Actions and are never exported to the `gha` cache backend. By converting the dependency download into a standard Docker layer, it is now perfectly cached and instantly restored across independent workflow runs, saving ~1 minute and 30 seconds of redundant library downloads!
- **Frontend E2E Read-Only Cache:** In the `frontend-pipeline`, the embedded Spring Boot backend is only spun up to serve API requests for Playwright; it does not actually produce new build artifacts we care about. We configured its Gradle caching step with `cache-read-only: true`. This prevents the frontend runner from wastefully spending ~20-30 seconds uploading cache metadata at the end of its job, since the `backend-pipeline` job already handles cache writing.
- **Missing gradle.properties in Docker:** We discovered that `Dockerfile.x64` was omitting `gradle.properties` during the initial `COPY` step. This meant that the Gradle instance running inside Docker silently ignored all the high-performance tunings (`org.gradle.parallel=true`, `org.gradle.configuration-cache=true`, and optimized JVM heap sizes). Copying this file into the build context unleashes the full speed of Gradle inside the container.
- **Embedded E2E Gradle Caching:** The background Spring Boot `bootRun` command (used to serve the backend for Playwright tests) has been updated to use `--parallel --build-cache`. This allows the frontend runner to instantly pull the pre-compiled Java classes from the Gradle cache instead of recompiling the entire Spring application from scratch inside the Node.js runner.
- **CodeQL Build-Mode None:** CodeQL SAST scanning for Java used to require a full `./gradlew clean compileJava` without caching to trace compiler invocations. By switching to `build-mode: none`, we bypass the ~60-second compilation step entirely and let CodeQL perform syntax-based analysis instead.
- **CodeQL Contextual Skipping:** We added a `needs: changes` dependency and a job-level `if` condition to the `codeql-analysis` job. Previously, it would run on every manual `workflow_dispatch` trigger regardless of whether `run_security_scans` was toggled. Now, it respects the user's manual inputs, skipping the entire SAST matrix when security scans are disabled, saving precious compute minutes.
- **Dockerignore Context Optimization:** We created `.dockerignore` and `frontend/.dockerignore` files to explicitly prevent local development artifacts, logs, and massive `node_modules/` or `build/` directories from being uploaded to the Docker daemon during `docker/build-push-action`. Without this, the `COPY . .` step in the frontend Dockerfile was silently overwriting the optimized Linux `node_modules` generated by `npm ci` with hundreds of megabytes of host-generated files, causing massive I/O bloat and cache invalidation.

## 11. Code Maintenance & Dependency Modernization
To ensure long-term stability and eliminate GitHub Actions deprecation warnings (specifically regarding Node.js 20 and CodeQL v3 retirements):
- **Action Bumps:** Upgraded all GitHub Action tags (`actions/checkout@v7`, `actions/setup-java@v5`, `codeql-action@v4`, etc.) to their latest major releases. These native Node 24 versions eliminate all runtime shim warnings and prevent sudden CI breakages when older Node versions are decommissioned.
- **Frontend Vitest Coverage Integration:** The Angular 22 `ng test` (powered by Vitest) command was strictly configured with the `--coverage` flag, and `@vitest/coverage-v8` was installed to correctly emit `frontend/coverage/` directories. This ensures artifact uploaders do not fail silently when archiving test metrics.
- **Gradle Daemon Tuning Preservation:** Eradicated CLI JVM overrides (`-Dorg.gradle.jvmargs`) from CI commands (`./gradlew check` and `bootRun`). This restores the highly tuned `-XX:+UseParallelGC` directives present in `gradle.properties` that were previously being unintentionally overwritten during execution.
