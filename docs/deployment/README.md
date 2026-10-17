# TaskFlow Deployment Manifests & Migration Hooks

This directory contains Kubernetes manifest templates and Kustomize patches intended to be synchronized with the production GitOps repository (`homelab/TF/gitops/apps/taskflow/`).

## Inventory

| File | Purpose |
| :--- | :--- |
| `booking-time-migration-presync-job.yaml` | ArgoCD `PreSync` Kubernetes Job executing data backfill before schema migration. |
| `booking-time-migration-kustomization.yaml` | Kustomize resource that packages `scripts/prepare-booking-time-migration.sh` into a ConfigMap mounted by the PreSync Job. |

---

## Booking Time Migration (Flyway V22 Preparation)

### Background & Motivation
In Flyway migration `V22__convert_booking_time_to_time.sql`, the `booking_time` column on the `appointments` table is converted from a `VARCHAR` string to PostgreSQL's native `TIME` type.

To ensure zero downtime and prevent migration lockups on legacy rows:
- Historical bookings may contain unpadded 4-character time strings (e.g. `"9:00"` instead of `"09:00"`).
- Direct column type conversion in PostgreSQL fails if any malformed or non-standard format is encountered.
- The `PreSync` job runs ahead of the application pod rollout, ensuring data cleanliness before Flyway executes during Spring Boot initialization.

### Execution Model
1. **ArgoCD PreSync Hook:** `booking-time-migration-presync-job.yaml` specifies `argocd.argoproj.io/hook: PreSync` and `sync-wave: "-1"`. ArgoCD runs this Job to completion before initiating the main application Deployment update.
2. **Hardened Container Runtime:** The container runs under unprivileged numeric UID `999` with `drop: ["ALL"]` kernel capabilities, runtime-default seccomp, and a read-only root filesystem.
3. **Mounted Script:** `scripts/prepare-booking-time-migration.sh` is mounted into `/scripts/` as a read-only executable via `booking-time-migration-kustomization.yaml` ConfigMap generator.

### Deployment Instructions
When rolling out schema upgrades to production:
1. Copy `booking-time-migration-presync-job.yaml`, `booking-time-migration-kustomization.yaml`, and `scripts/prepare-booking-time-migration.sh` to the GitOps repository.
2. Replace `REPLACE_WITH_POSTGRES_SERVICE` and `REPLACE_WITH_DATABASE_SECRET` with the actual production service and Secret references.
3. Commit and sync through ArgoCD.

## Upgrade Notes (2026-10-17, BENCHMARKS.md §58)

Things to check in the GitOps repository and in monitoring when deploying this release:

- **Flyway V36 (admin search trigram indexes):** PostgreSQL only. It runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` (a trusted extension since PostgreSQL 13, shipped in the official images) and builds three GIN indexes inside the migration transaction, which blocks writes to `appointments` while they build (about 2 s per 180k rows). If the extension cannot be created the migration logs a WARN and the search stays unindexed; a DBA can add it later (see `src/main/java/db/migration/V36__admin_search_trigram_indexes.java`).
- **Prometheus queries:** the client-side `http_server_requests_seconds{quantile="…"}` series are gone; compute percentiles with `histogram_quantile(0.95, sum by (le, uri) (rate(http_server_requests_seconds_bucket[5m])))`. The Spring Security observations are disabled, so `spring_security_*` metrics are no longer exported. Update dashboards and alerts that use either.
- **Redis timeout:** `spring.data.redis.timeout` is 250 ms in the `prod` profile (was 2 s). Redis failures now fail open (ADR-018): the caches fall back to the database and log at most one WARN per 30 s. Alert on that WARN or on Redis availability, since request errors no longer show an outage.
- **Hikari leak detection** is off in `prod` (`leak-detection-threshold=0`); turn it on temporarily with `SPRING_DATASOURCE_HIKARI_LEAK_DETECTION_THRESHOLD` when investigating a leak.
- **Ingress / keep-alive:** Tomcat now allows 10,000 requests per keep-alive connection. An ingress that pools upstream connections should close idle ones before Tomcat's 60 s timeout (nginx in this repo uses `keepalive_timeout 50s`).
