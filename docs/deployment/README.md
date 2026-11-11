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

## Upgrade Notes (2026-10-20, BENCHMARKS.md §59)

The Compose stack now carries these settings; the manifests in `homelab/TF/gitops/apps/taskflow/` need the matching changes:

- **PostgreSQL `/dev/shm`:** container runtimes give a pod 64 MB of `/dev/shm`. With `work_mem=16MB` one parallel hash join may use 16 MB × 2 (`hash_mem_multiplier`) × 3 processes = 96 MB of dynamic shared memory, and on PostgreSQL 18.6 it fails at 64 MB with `could not resize shared memory segment … No space left on device`. If PostgreSQL runs in the cluster, mount a memory-backed volume (it counts against the pod's memory limit, so leave room for it):

  ```yaml
  volumes:
    - name: dshm
      emptyDir: { medium: Memory, sizeLimit: 256Mi }
  # in the postgres container:
  volumeMounts:
    - { name: dshm, mountPath: /dev/shm }
  ```

  Also mirror `wal_compression=lz4` (the official images are built `--with-lz4`) if the production server configuration lives there.
- **Frontend nginx open-file limit:** containerd 2.1.5 (and Docker Engine 29) start containers with a soft `nofile` limit of 1024. The image's `worker_rlimit_nofile 8192` raises the workers' soft limit without any capability, as long as the hard limit is at least 8192 (the systemd default hard limit is 524288). If the frontend logs `setrlimit(RLIMIT_NOFILE, 8192) failed`, raise the hard limit in the node's containerd service; Kubernetes has no per-pod `ulimit`.
- **Backend JVM diagnostics:** do not write the heap dump or GC log to a memory-backed `/tmp` (`emptyDir: { medium: Memory }`). Those pages count against the container's memory limit, so a heap-sized dump on top of the running JVM invites the OOM killer. Mount a disk-backed volume at the directory the image now creates for the runtime user, and change `JAVA_TOOL_OPTIONS` in `backend.yaml`:

  ```yaml
  # JAVA_TOOL_OPTIONS: replace the two /tmp paths with
  #   -XX:HeapDumpPath=/var/log/taskflow -Xlog:gc*:file=/var/log/taskflow/gc.log:time,uptime:filecount=3,filesize=10m
  volumes:
    - name: diagnostics
      emptyDir: { sizeLimit: 2Gi }   # 1 GiB heap dump + 3 × 10 MB GC logs; a PVC also survives pod deletion
  # in the backend container:
  volumeMounts:
    - { name: diagnostics, mountPath: /var/log/taskflow }
  ```

  `ExitOnOutOfMemoryError` makes the kubelet restart the container in the same pod, and an `emptyDir` survives that restart, so the dump stays readable with `kubectl cp` or `kubectl debug`. The dump is named `java_pid<pid>.hprof`, and an existing file is never overwritten. Under tini the JVM gets the same PID in every restarted container, so while that file exists a later OOM writes no dump at all (the JVM logs `Unable to create … File exists`): copy it off and delete it after analysis. A PVC instead of the `emptyDir` keeps the dump across pod deletion, but most volume types are not created writable for UID 10001: set `securityContext.fsGroup: 10001` on the pod. The GC log rotates the previous run's file to `gc.log.0` when the JVM starts.
- **Frontend `/` routing (ingress):** the guest landing is prerendered. nginx in the frontend image serves `index.html` (prerendered) for `/` to guests and `index.csr.html` when the request carries an `access_token` cookie (and for every other client route), and sends `Vary: Cookie` on `/`. The ingress must pass `/` and the `Cookie` header through unchanged and must not cache `/` or any HTML (both shells are `Cache-Control: no-cache`). It must not add its own `Content-Security-Policy` or rewrite the HTML: the image's CSP authorizes the inline scripts by their sha384 hashes, so an ingress CSP or an injected script blocks hydration.

## Upgrade Notes (2026-11-01, frontend nginx edge)

The frontend image changed how it reaches the backend and what it forwards; check the frontend manifests in `homelab/TF/gitops/apps/taskflow/`:

- **Resolver moved into the upstream file.** `nginx-main.conf` no longer sets `resolver 127.0.0.11` (Docker's embedded DNS, which does not exist in a pod). The resolver now sits next to the backend address in `/etc/nginx/upstream-server.conf` (upstream-level [`resolver`](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolver), nginx 1.27.3+; the image ships 1.30), so the file a deployment mounts there controls both. A mounted file that uses `resolve` without its own `resolver` now fails at startup with `no resolver defined to resolve names at run time in upstream "backend_upstream"`. Pick one of:

  ```nginx
  # A: static ClusterIP Service (simplest). No `resolve`, no `resolver`: nginx resolves the
  # name once at startup through the pod's /etc/resolv.conf; a ClusterIP is stable for the
  # Service's lifetime, and kube-proxy spreads connections across the backend pods.
  server taskflow-backend.taskflow.svc.cluster.local:8080;

  # B: re-resolve at run time, e.g. a headless Service (pod IPs, nginx balances itself).
  # nginx's resolver ignores resolv.conf search domains: use the FQDN. The resolver is the
  # cluster DNS Service (`kubectl -n kube-system get svc kube-dns`; 10.43.0.10 on k3s,
  # 10.96.0.10 on kubeadm); its name also works, it is resolved once at startup.
  resolver kube-dns.kube-system.svc.cluster.local valid=30s;
  server taskflow-backend.taskflow.svc.cluster.local:8080 resolve;
  ```

  Mount the file over `/etc/nginx/upstream-server.conf` (a ConfigMap with `subPath`), as CI does with `frontend/nginx-upstream-server-ci.conf`.
- **X-Forwarded-Proto.** nginx used to send `X-Forwarded-Proto: $scheme`, always `http` because the image listens on plain HTTP, overriding a TLS ingress's `https` (Spring then built `http://` redirects and treated requests as insecure). It now forwards the incoming `X-Forwarded-Proto` (`http` or `https` only) when, and only when, the mounted `/etc/nginx/real-ip.conf` trusts the peer (`set_real_ip_from`, see `frontend/nginx-real-ip.conf`); every other request still gets `http`. The ingress must set or overwrite `X-Forwarded-Proto` itself (ingress-nginx and Traefik do by default). With HTTPS reaching Spring, Spring Security also writes `Strict-Transport-Security`; nginx hides the backend's copy and sends its own, as it now does for every security header it sets (two `Cross-Origin-Resource-Policy` fields had made browsers ignore CORP).
- **API timeouts and errors.** `/api/` now gives up after 5 s connecting and 30 s waiting for the backend (was 60 s each), and answers its own 502/503/504 with an RFC 9457 `application/problem+json` body instead of nginx's HTML page. The admin SSE stream keeps its 1 h read timeout. An ingress timeout above 30 s on `/api/` no longer extends anything.
- **Asset caching.** `Cache-Control: public, immutable, max-age=15552000` is no longer sent on error responses, so a 404 for a chunk during a rolling deploy or rollback is not cached for 6 months. An ingress or CDN in front must not add its own long-lived caching to 4xx/5xx responses either.

## Upgrade Notes (2026-11-11, BENCHMARKS.md §65)

Mirror these in `homelab/TF/gitops/apps/taskflow/`:

- **Backend `JAVA_TOOL_OPTIONS`: add `-XX:InitialRAMPercentage=50.0`** next to `-XX:MaxRAMPercentage=50.0`. `-XX:+AlwaysPreTouch` touches only the initial heap, which ergonomics sets to 1/64 of the memory limit (40 MiB at 2560M), so the eager allocation ADR-002 intended never happened and G1 committed the rest during pauses under load. With the flag the pod is resident at about 1.4 GiB right after start (measured on JDK 25: boot 9.97 → 10.61 s, peak RSS 624 → 1418 MiB, GC pauses while booting 54 → 33); the 2560M limit already budgets for that heap. Keep the memory request at or above that figure so the scheduler does not overcommit the node.
- **Flyway V42** replaces `idx_appointments_booking_date`, `idx_appointment_status` and `idx_appointment_barber_date` with one `(booking_date, booking_time, id)` index. It is built inside the migration transaction: writes to `appointments` wait for it during the rollout (86 ms at 180k rows). Before the rollout, confirm the two V1 indexes are unused in production too: `SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname = 'appointments';`

## Upgrade Notes (2026-11-12, BENCHMARKS.md §66)

- **Production Redis: add `--save ""`** next to `--appendonly yes --appendfsync everysec` (Compose has both). The default RDB save points forked a background snapshot every few minutes under the rate-limiter's write load, redundant with the AOF; the AOF rewrite still compacts the file. Check with `redis-cli CONFIG GET save` (empty value = no snapshots).
- **Web telemetry is a build flag.** The frontend bundle reports Web Vitals and uncaught errors only when it was built with `npx ng build --define TASKFLOW_TELEMETRY_SAMPLE_RATE=0.1` (share of page loads, 0 < rate <= 1). The images CI publishes are built without it, so they send nothing, as before. With it, `taskflow_client_performance_bucket{name="LCP",le="2500.0"}` over `taskflow_client_performance_count` is the share of page loads with a good LCP.
- **Frontend caching:** the Inter font and the background image are now content-hashed under `/media/` and sent `Cache-Control: public, immutable, max-age=15552000`. A CDN or ingress in front of nginx that overrides cache headers by extension should leave `/media/` alone.

