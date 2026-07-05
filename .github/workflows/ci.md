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
- **E2E Artifact Uploads**: Uploads the `playwright-report/` upon completion.
  - **Why:** If an E2E test fails, developers can download the HTML report and traces to visually debug what went wrong in the browser.
- **FinOps Artifact Retention (`retention-days: 7`)**:
  - **Why:** Applied to all `upload-artifact` steps (test results, jacoco, playwright). GitHub defaults to 90 days of retention, which rapidly consumes storage quotas. Test reports are generally useless after a few days, so a 7-day retention heavily optimizes cloud storage costs.
