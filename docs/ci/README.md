# CI / CD Documentation

Prose documentation and reference catalog for the **TaskFlow Enterprise** GitHub Actions pipelines.

The executable workflow definitions live in [`.github/workflows/`](../../.github/workflows/). This directory holds design rationale, architectural notes, and point-in-time audit reports.

---

## 📚 Document Index

| Document | Description |
| :--- | :--- |
| [overview.md](overview.md) | Comprehensive architectural design rationale for `.github/workflows/ci.yml` and related workflows: triggers, concurrency groups, least-privilege permissions, caching strategies, and container hardening. |
| [audit-2026-08-20.md](audit-2026-08-20.md) | Point-in-time security and correctness audit of all pipelines, tracking resolutions and historical context. |

---

## 🤖 GitHub Actions Workflow Catalog

The repository maintains **14 dedicated workflow files** in `.github/workflows/`, separated by operational domain and security boundary:

| Workflow File | Purpose | Triggers & Schedule | Gating & Filters | Permissions | Primary Outputs & Artifacts |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [`ci.yml`](../../.github/workflows/ci.yml) | Core CI pipeline: backend compilation & tests, frontend build & tests, contract gate, Playwright E2E, and local Docker image builds. | `push: [main]`, `pull_request: [main]`, `schedule: [0 22 * * *]` (nightly 03:00 UTC), `workflow_dispatch` | Paths-filter per stack (`dorny/paths-filter`). Emits required check gates: `Backend`, `Frontend`, `End-to-End Tests`. | `contents: read` (default); job-scoped `pull-requests: read`, `security-events: write`, `contents: write` | `backend-jar`, `frontend-dist`, test reports (`test-results`, `playwright-report`), Trivy image SARIF |
| [`react-native-ci.yml`](../../.github/workflows/react-native-ci.yml) | Mobile CI: TypeScript checks, Jest tests, Android native APK compilation, and iOS Simulator `.app` build. | `push: [main]` (paths-filtered), `pull_request: [main]` (unfiltered trigger), `schedule: [32 22 * * *]` (nightly), `workflow_dispatch` | Internal `changes` job gates native steps while satisfying branch protection on all PRs via `mobile-js-gate`, `android-gate`, `ios-gate`. | `contents: read` | Test reports, ccache snapshots, native build validation |
| [`gitleaks.yml`](../../.github/workflows/gitleaks.yml) | Secret scanning: scans git commits for secrets and API keys using direct, checksum-pinned Gitleaks CLI. | `push: [main]`, `pull_request: [main]`, `schedule: [24 22 * * *]` (nightly), `workflow_dispatch` | Unfiltered trigger; required status check context: `Gitleaks Secret Scan`. | `contents: read`, job-scoped `security-events: write` | SARIF upload (`gitleaks`), failure artifact `gitleaks-report` |
| [`security.yml`](../../.github/workflows/security.yml) | Nightly static code analysis and filesystem vulnerability scanning. | `schedule: [8 22 * * *]` (nightly 03:08 UTC), `workflow_dispatch` | Full repository scan across 4 CodeQL matrix legs and 5 Trivy filesystem directories. | `contents: read`, `security-events: write` | CodeQL SARIF (`/language:...`), Trivy FS SARIF (`trivy-fs-...`) |
| [`dast.yml`](../../.github/workflows/dast.yml) | Dynamic Application Security Testing: spins up ephemeral PostgreSQL, Redis, backend, and Nginx for OWASP ZAP API & Web scans. | `schedule: [16 22 * * *]` (nightly 03:16 UTC), `workflow_dispatch` (`scan_scope`, `fail_on_findings`, `enable_ajax_spider`) | Independent parallel `dast-api` and `dast-web` jobs; gated by `dast-gate`. | `contents: read`, `security-events: write` | ZAP SARIF (`dast-zap-api`, `dast-zap-web`), HTML/JSON reports (`zap-api-scan`, `zap-web-scan`) |
| [`nightly-external-server-scan.yml`](../../.github/workflows/nightly-external-server-scan.yml) | Production perimeter audit: origin-pinned port scans, TLS security audits, and web vulnerability scans against the live host. | `workflow_dispatch` only (manual parameterized: `target_ip`, `target_host`, `port_scan_scope`, `scan_components`, `upload_raw_artifacts`) | Quality gate fails on unexpected open ports, Nuclei HIGH/CRITICAL, or testssl.sh TLS vulnerabilities. | `contents: read`, `security-events: write` | Nuclei SARIF (`nightly-external-nuclei`), sanitized Step Summary metrics, optional raw reports |
| [`pushdockerimage.yml`](../../.github/workflows/pushdockerimage.yml) | Production container release: builds, generates SLSA provenance and SBOM attestations, runs Trivy gate, and pushes to GHCR. | `workflow_dispatch` only (inputs: `components`, `image_tag`, `skip_scan`) | Two-stage promotion: builds to `:<tag>-scan`, scans digest, and promotes to `:<tag>` and `:latest` without rebuilding. | `contents: read` (default); `push` job has `packages: write`, `security-events: write` | Published OCI container images in GHCR (`ghcr.io`), Trivy SARIF |
| [`expo-maintenance.yml`](../../.github/workflows/expo-maintenance.yml) | Automated Expo SDK compatibility maintenance: aligns package versions and opens/refreshes PRs. | `schedule: [47 22 * * 0]` (weekly Sunday/Monday), `workflow_dispatch` (`dryRun`) | Pre-validates TypeScript (`lint`) and unit tests (`jest`) before creating PR; automatically closes obsolete maintenance PRs. | `contents: read` (uses `RENOVATE_TOKEN` secret to trigger downstream CI) | Pull request on branch `maintenance/expo-sdk` |
| [`renovate.yml`](../../.github/workflows/renovate.yml) | Automated dependency lifecycle: runs Renovate bot to manage daily updates and grouping. | `schedule: [40 22 * * *]` (daily), `workflow_dispatch` (`dryRun`, `logLevel`, `repoCache`) | Governed by `.github/renovate.json`: 3-day quarantine soak on patch/pin/digest automerge; grouped version-coupled PRs. | `contents: read` (uses `RENOVATE_TOKEN` secret) | Dependency pull requests, Dependency Dashboard issue |
| [`dependency-health-audit.yml`](../../.github/workflows/dependency-health-audit.yml) | Weekly dependency hygiene audit: evaluates Renovate dashboard, lockfile drift, unused packages, and deprecations. | `workflow_run` (chains off completion of Renovate on `main`), `workflow_dispatch` | Narrows execution to Mondays (UTC) to maintain weekly cadence. | `contents: read` | Step Summary report, `dependency-audit-report` artifact |
| [`k6.yml`](../../.github/workflows/k6.yml) | Remote performance and Core Web Vitals smoke testing against production `vars.BASE_URL`. | `workflow_dispatch` only | Executes `k6/browser.js` (CWV smoke test) and `k6/probe.js` (rate-limit-safe one-request/sec probe). | `contents: read` | k6 performance logs and Step Summary |
| [`cleanup-packages.yml`](../../.github/workflows/cleanup-packages.yml) | Prunes stale, untagged container package versions in GHCR older than 3 days. | `workflow_dispatch` only (`confirm_delete: boolean`, defaults to dry-run) | Deletion capped at 50 per run to prevent accidental mass deletion; preserves tagged images. | `packages: write` (no checkout required) | Package pruning execution log |
| [`cleanup-pr-caches.yml`](../../.github/workflows/cleanup-pr-caches.yml) | Cache housekeeping: deletes Actions caches scoped to closed or merged PRs (`refs/pull/<n>/merge`). | `pull_request: [closed]` | Runs only for same-repository pull requests (skips forks where token is read-only). | `actions: write` (no checkout required) | Cache deletion API calls |
| [`delete-old-caches.yml`](../../.github/workflows/delete-old-caches.yml) | Weekly repository cache garbage collection: sweeps caches inactive for 3+ days. | `schedule: [4 22 * * 6]` (weekly Saturday 22:04 UTC), `workflow_dispatch` | Filters by `last_accessed_at < cutoff` to protect actively accessed caches while respecting the 10 GB quota. | `actions: write`, `contents: read` | Cache cleanup execution summary |

---

## 🔒 Branch Protection & Required Status Checks

The `Protect main and require CI` branch protection ruleset requires the following **7 status checks** before pull requests can merge or automerge:

1. **`Backend`** (emitted by `backend-gate` in `ci.yml`): Aggregates `changes`, `backend` (unit tests + JaCoCo coverage $\ge 80\%$), `backend-integration` (Testcontainers + SpotBugs), `package`, and `contract` (OpenAPI baseline).
2. **`Frontend`** (emitted by `frontend-gate` in `ci.yml`): Aggregates `changes`, `frontend` (theme tokens, ESLint, strict TypeScript, and Vitest unit tests).
3. **`End-to-End Tests`** (emitted by `e2e-gate` in `ci.yml`): Aggregates `changes`, `package`, `frontend`, and `e2e` (Playwright on Dockerized Nginx and backend).
4. **`Mobile JavaScript`** (emitted by `mobile-js-gate` in `react-native-ci.yml`): Aggregates TypeScript typecheck (`tsc --noEmit`), security regression tests, and Jest unit tests.
5. **`Android build and test`** (emitted by `android-gate` in `react-native-ci.yml`): Aggregates native Android APK assembly and configuration tests.
6. **`iOS simulator build`** (emitted by `ios-gate` in `react-native-ci.yml`): Aggregates CocoaPods resolution and macOS xcodebuild simulator compilation.
7. **`Gitleaks Secret Scan`** (emitted by `gitleaks` job in `gitleaks.yml`): Unfiltered secret scan on every PR commit.

> **Aggregator Gate Architecture:** Because GitHub Actions marks skipped jobs as *success* under branch protection, dedicated aggregator jobs (`*-gate`) consume prerequisite results via the `.github/actions/require-job-results` composite action. If a required build fails, the gate fails closed and prevents unverified merges.

---

## 🧩 Shared Local Composite Actions (`.github/actions/`)

Reusable workflow step logic is encapsulated in local composite actions to prevent duplicate code and workflow drift:

- **[`npm-ci`](../../.github/actions/npm-ci/action.yml):** Installs `shared/schemas` then the target client package (`frontend` or `mobile`) with `npm ci`. Supports opt-in `cache-node-modules` for exact lockfile hits.
- **[`start-backend`](../../.github/actions/start-backend/action.yml):** Generates ephemeral RSA key pairs, launches `backend-jar`, and polls `/actuator/health/liveness`. Supports non-blocking launch (`wait: "false"`) to overlap JVM startup with Node setup.
- **[`wait-backend`](../../.github/actions/wait-backend/action.yml):** High-speed readiness poller checking `/actuator/health/liveness` every 1 second, failing fast with application log output if the process crashes.
- **[`prepull-buildkit`](../../.github/actions/prepull-buildkit/action.yml):** Configures Docker Buildx with a pre-pulled BuildKit daemon for jobs requiring GitHub Actions cache export (`type=gha`) or multi-platform builds.
- **[`upload-sarif`](../../.github/actions/upload-sarif/action.yml):** Standardized wrapper around `github/codeql-action/upload-sarif` with stable category assignment and optional `wait-for-processing` controls.
- **[`require-job-results`](../../.github/actions/require-job-results/action.yml):** Backs the branch protection aggregator gates, verifying that all required jobs passed and no upstream job silently failed.

---

## ⏱️ Scheduled Cron Lag Compensation

All nightly crons in this repository are scheduled between **22:00 and 22:50 UTC** to compensate for GitHub's observed scheduler queuing delay. On this repository, scheduled workflows consistently execute **~4.5 to 5.5 hours after their defined cron timestamp**. Scheduling at 22:xx UTC ensures execution reliably lands in the target low-traffic window between **03:00 and 04:00 UTC**.

---

## 🔗 Related Documentation

- [Detailed CI/CD Design Rationale](overview.md)
- [Workflow Audit Report (2026-08-20)](audit-2026-08-20.md)
- [Zero-Trust Security & Container Hardening Policy](../../SYSTEM-HARDENING.md)
- [Architecture Decision Records (ADRs)](../adr/)
