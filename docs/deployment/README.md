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
