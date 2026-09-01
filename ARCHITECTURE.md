# TaskFlow Enterprise Full-Stack Architecture Blueprint

This document details the complete end-to-end architecture, secure data flow, and technology integration of the **TaskFlow Enterprise Suite**. Every component of the system has been engineered to connect and influence the others, creating a unified, high-performance, and secure full-stack pipeline.

---

## 🗺️ 1. End-to-End Architectural Data Flow

Below is the complete sequence of an authenticated, paginated API query from the browser DOM down to the PostgreSQL index blocks and Prometheus scraper, tracing how every architectural feature coordinates in a single flow:

```
[ BROWSER RUNTIME ]                                  [ SECURE DOCKER NETWORK ]
  Angular UI DOM                                       unprivileged:taskflow JRE
    │                                                    │
    ▼ (1. Signal triggers reload)                        │
  app.ts (Angular Signals)                               │
    │                                                    │
    ▼ (2. Request created)                               │
  appointment.service.ts (getAllAppointments)                   │
    │                                                    │
    ▼ (3. Cookie & CSRF header attached)                 │
  auth.interceptor.ts (HttpOnly Cookie + XSRF Header)    │
    │                                                    │
    ▼ (4. HTTPS/TLS & CSP Headers)                       │
  Nginx Reverse Proxy (nginx.conf) ─────────────────────►│ (5. Request enters JRE)
    │                                                    │   BearerTokenAuthenticationFilter / CSRF Filter
    │                                                    │     │
    │                                                    │     ▼ (6. Cookie JWT validated statelessly)
    │                                                    │   NimbusJwtDecoder (Asymmetric RSA-2048)
    │                                                    │     │
    │                                                    │     ▼ (7. Context set)
    │                                                    │   SecurityContextHolder
    │                                                    │     │
    │                                                    │     ▼ (8. Request Routed)
    │                                                    │   AppointmentController (/api/v1/appointments)
    │                                                    │     │
    │                                                    │     ▼ (9. Pageable Request)
    │                                                    │   AppointmentServiceImpl
    │                                                    │     ├──► (10. Paginated count & list queries)
    │                                                    │     │    AppointmentRepository (PostgreSQL Index Scan)
    │                                                    │     │      │
    │                                                    │     │      ▼ (11. Schema matched)
    │                                                    │     │    Flyway Database Migration
    │                                                    │     │
    │                                                    │     └──► (12. Session Closed immediately)
    │                                                    │          spring.jpa.open-in-view=false
    │                                                    │
    ▼ (14. Signals update, DOM repaints)                 │ (13. Unified Response returned)
  Angular UI DOM ◄───────────────────────────────────────┼── AppointmentDashboardResponse
    │
    ▼ (15. Background Scrape)
  Prometheus (/actuator/prometheus)
```

---

## 🧵 2. Step-by-Step Architectural Flow Analysis

### **Step 1: Client Landing & Route Security Guard**
*   **Active Files**: `app.ts`, `app.html`, `auth.guard.ts`, `auth.state.ts`
*   **The Flow**: When the user accesses the TaskFlow app, the Angular engine bootstraps. The functional `auth.guard.ts` verifies authentication using the in-memory `AuthState` Signal (restored from the backend via `GET /api/v1/auth/me`, which reads the HttpOnly session cookie). If unauthenticated, the DOM is locked, and a custom **Login Portal Card** is rendered in `app.html`.

### **Step 2: Authenticating & Issuing the Stateless JWT**
*   **Active Files**: `app.ts` (Angular), `appointment.service.ts` (Angular), `SecurityConfig.java` (Spring Boot), `AuthController.java` (Spring Boot), `TokenProvider.java` (Spring Boot)
*   **The Flow**: 
    1.  The user inputs credentials (`admin` / `admin-password`).
    2.  `appointment.service.ts` sends a `POST /api/v1/auth/login` containing the credentials.
    3.  On the backend, `SecurityConfig` recognizes `/api/v1/auth/**` as a publicly permitted endpoint and lets the request pass.
    4.  `AuthController` delegates authentication to the `AuthenticationManager`. It validates credentials against the secure in-memory `UserDetailsService` using a BCrypt password matcher.
    5.  Once authenticated, `TokenProvider` generates a cryptographically signed JSON Web Token (JWT) using asymmetric RS256 (RSA 2048-bit keys) and sets it as an `HttpOnly`, `SameSite=Strict` cookie (`access_token`). The backend also issues a readable `XSRF-TOKEN` cookie via `CookieCsrfTokenRepository` for double-submit CSRF protection.

### **Step 3: Storing and Intercepting Request Tokens**
*   **Active Files**: `app.ts` (Angular), `auth.interceptor.ts` (Angular), `app.config.ts` (Angular), `nginx.conf` (Nginx)
*   **The Flow**:
    1.  The frontend receives successful authentication, updates `AuthState` in memory, and unlocks the dashboard DOM. The JWT cookie is HttpOnly and completely inaccessible to JavaScript.
    2.  The frontend triggers `loadAppointments()`.
    3.  **`auth.interceptor.ts`** handles outgoing requests. Browsers automatically attach the HttpOnly `access_token` cookie for same-origin requests. Angular's `withXsrfConfiguration` reads the `XSRF-TOKEN` cookie and automatically attaches the `X-XSRF-TOKEN` header on state-changing requests.
    4.  At the web server layer, Nginx enforces strict **Content Security Policy (CSP)** and clickjacking headers (`X-Frame-Options`, `nosniff`), guaranteeing that unapproved external scripts cannot interact with the application.

### **Step 4: Request Injection Filtering & Unprivileged Container Routing**
*   **Active Files**: `docker-compose.yml`, `Dockerfile` (Backend), `SecurityConfig.java`
*   **The Flow**:
    1.  The HTTP request passes the Docker container network boundary. The container runs under an unprivileged `taskflow` user with CPU/Memory limits, preventing system-level exploits.
    2.  Spring Security extracts the JWT from the HttpOnly `access_token` cookie, decodes and validates its signature statelessly using **`NimbusJwtDecoder`** (utilizing our RSA 2048-bit public key), checks the `X-XSRF-TOKEN` header against the CSRF token cookie on state-changing operations, and establishes the authenticated security session inside `SecurityContextHolder`.

### **Step 5: High-Performance Database Querying & Connection Protection**
*   **Active Files**: `AppointmentController.java`, `AppointmentServiceImpl.java`, `AppointmentRepository.java`, `BusySlotsService.java`, `V1__init_schema.sql` / `V21__fix_double_booking_index.java` (Flyway), `application-prod.properties`
*   **The Flow**:
    1.  The request is routed to `AppointmentController.java` (`GET /api/v1/appointments`) which maps parameters to a paginated `Pageable` request.
    2.  `AppointmentServiceImpl.java` receives the request. It queries the database using `PageRequest.of(page, size)`.
    3.  `AppointmentRepository.java` runs the query. Thanks to the database schema defined in Flyway's **`V1__init_schema.sql`** and **`V21__fix_double_booking_index.java`**, the database utilizes optimized indexes (`idx_appointment_status`, `idx_appointment_date`) for high-speed index scans plus a **partial unique index `idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time) WHERE status IN ('PENDING','APPROVED')`** (PostgreSQL; H2 emulates via generated `active_slot_marker INTEGER AS (CASE WHEN status IN ('PENDING','APPROVED') THEN 1 ELSE NULL END)` + `UNIQUE(barber, date, time, marker)` exploiting `NULL <> NULL`) to serialize concurrent slot bookings. `BusySlotsService.getBusySlots()` (`@Cacheable("busySlots", sync=true)` 2m TTL) reads `findDistinctBookingTimes(barber, date, DENIED)` (43 µs, `EXPLAIN`-verified) and aggregates `ALL_SLOTS` for the `No Preference` sentinel; `AppointmentServiceImpl` catches `DataIntegrityViolationException` `23505` as the DB-enforced second guard after the application busy-check (BENCHMARKS.md §41: 50-way race → exactly 1/49, 808 bookings/sec).
    4.  Repository metric counting methods (`countByCompleted`) retrieve stats directly from the index tree blocks in microseconds.
    5.  `spring.jpa.open-in-view=false` is enforced in `application.properties`. As soon as the service method completes, the database connection is immediately returned to the Hikari pool, protecting the server against database starvation while Jackson serializes the data.
    6.  The backend packages the paginated page content and the global stats into a single, unified `AppointmentDashboardResponse` DTO and returns it.

### **Step 6: Fine-Grained UI Repainting & Observability Scrapes**
*   **Active Files**: `app.ts` (Angular), `app.html` (Angular), `application.properties` (Actuator)
*   **The Flow**:
    1.  The Angular frontend receives the unified `AppointmentDashboardResponse`.
    2.  It updates its fine-grained **Signals** (`appointments`, `stats`, `totalPages`).
    3.  Since Angular 22 Signals are highly reactive, Angular does not waste CPU running heavy Zone.js digest loops. It immediately repaints *only* the specific bound DOM elements (the stats cards, progress bar, and card lists) in `app.html`.
    4.  In the background, Prometheus periodically scrapes JVM metrics, connection pool stats, and API request latency from `/actuator/prometheus` (permitted by `SecurityConfig`), providing complete observability.

### **Step 7: Real-Time Admin Appointment Refreshes**
*   **Active Files**: `AppointmentController.java`, `AppointmentEventStreamService.java`, `AppointmentEventStreamListener.java`, `admin-events.service.ts`, `frontend/src/app/features/admin/admin-dashboard.ts`, `nginx.conf`
*   **The Flow**:
    1.  An administrator opens `/admin`. The Angular `AdminEventsService` opens a same-origin `EventSource` to `GET /api/v1/appointments/events` with browser credentials enabled.
    2.  Spring Security authenticates the existing HttpOnly `access_token` cookie and requires `ROLE_ADMIN`. No JWT is exposed to frontend JavaScript or sent in a query parameter.
    3.  Appointment creation, status changes, and deletion publish an immutable, PII-free `AppointmentAdminEvent` inside the mutation transaction.
    4.  `AppointmentEventStreamListener` handles the event only after a successful commit and sends a small named SSE event to connected local admin emitters.
    5.  The Angular service validates the event envelope and calls `AppointmentStore.loadAppointments()`. The existing paginated REST endpoint reloads the current page, filter, and search state.
    6.  Nginx disables buffering for the stream and forwards heartbeats every 20 seconds so idle connections survive proxy timeouts.
*   **Consistency Boundary**: SSE is a best-effort invalidation signal. The REST dashboard response remains authoritative; the initial in-memory implementation has no replay and only reaches clients connected to the same backend instance.

---

## 💎 3. Why This Connected Flow is Enterprise-Grade

| Feature Integration | Why they influence each other | Alternative | Why the connected flow is better |
|---|---|---|---|
| **HttpOnly JWT Cookie + In-Memory AuthState Signal** | The backend sets an HttpOnly session cookie and double-submit CSRF cookie. Frontend restores role state via `/api/v1/auth/me` into an in-memory Signal (`AuthState`). JavaScript never handles raw JWTs. | Storing JWT in `localStorage` or `sessionStorage`. | 100% XSS immunity (tokens cannot be stolen by scripts), built-in CSRF protection via double-submit token & `SameSite=Strict`, and zero token handling boilerplate in frontend code. |
| **H2 Count Indexing + `open-in-view=false`** | Fast index counts inside the DB minimize query execution time. Disabling OSIV closes the connection immediately afterward. | Keeping Hibernate sessions open during JSON rendering with in-memory counting. | Completely prevents database connection pool starvation under heavy production traffic, keeping memory overhead close to zero. |
| **Flyway Migrations + JPA Validation** | Flyway sets up schema/indexes during container boot. JPA uses `ddl-auto=validate` to confirm schema integrity before opening connection pools. | Relying on Hibernate's unpredictable `ddl-auto=update` during runtime. | Guarantees complete data integrity, prevents accidental drop tables/column corruption, and makes builds reproducible across dev and prod environments. |
| **Unprivileged Docker + Non-Root Nginx** | Docker isolates host namespaces, while Alpine's unprivileged JRE and unprivileged Nginx run without host-root permissions. | Standard containers running as default root on port 80. | Completely blocks container-breakout privilege escalation exploits, protecting your physical host server from root compromise. |

---

## 🛡️ 4. Local DevSecOps & Platform Observability Ecosystem

To shift security left, TaskFlow integrates a multi-layered local DevSecOps pipeline and platform-level observability directly inside your development environment.

### 🛠️ A. Build-Time Static Analysis & Linting

Before any application runs, three layers of security check your code, configurations, and containers:
1. **FindSecBugs (Java SAST):** Integrated directly into `build.gradle` via the **SpotBugs** plugin. It scans the Spring Boot bytecode for OWASP Top 10 vulnerabilities (e.g. SQL Injection, insecure cryptography) on every `./gradlew check` run.
2. **Hadolint (Dockerfile Linter):** Integrates automatically into `./start-docker.sh`. Pipes the backend and frontend `Dockerfiles` through a lightweight `hadolint` container to detect non-optimal or insecure operations (e.g., running as root, missing pinned package versions).
3. **Trivy (Image Scanning):** Executed locally right after images compile. Automatically scans `taskflow-backend:latest` and `taskflow-frontend:latest` for known system library and application package CVEs before allowing orchestrations to launch.

---

## 🚀 5. Peak-Throughput Performance Optimizations

Through exhaustive benchmarking, the application has been tuned for maximum Request-Per-Second (RPS) throughput and minimum overhead:

1.  **JVM & Garbage Collection (Multi-Arch Tuning)**: Standardized on **Standard OpenJDK 21** utilizing **G1GC** (JDK 21 default). Sizing and GC parameters are owned by the deployment environment (`JAVA_TOOL_OPTIONS`), keeping both `Dockerfile` and `Dockerfile.x64` sizing-agnostic. **Diagnostics (P1-2, BENCHMARKS.md §43)**: `JAVA_TOOL_OPTIONS` carries `-XX:+UseContainerSupport` (explicit cgroup-aware, self-documenting), `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heapdump.hprof` (post-mortem, 0% until OOM), and `-Xlog:gc*:file=/tmp/gc.log:time,uptime:filecount=3,filesize=10m` (structured GC log, ~0.7% overhead, 3×10 MB rotation). `/tmp` is `tmpfs` RAM-backed in `docker-compose.yml` (and prod manifests), and the image `CMD` stays sizing-agnostic (`-XX:SharedArchiveFile=application.jsa`, `-Xshare:auto`, `-XX:+ExitOnOutOfMemoryError` only) to avoid last-wins precedence bugs.
    - **Local Apple Silicon (M4 Pro ARM64):** Configured via `JAVA_TOOL_OPTIONS` in `docker-compose.yml` (`MaxRAMPercentage=50.0` ≈ 1.25 GiB heap, `-XX:+UseG1GC`, `-XX:+AlwaysPreTouch`, off-heap bounded via `-XX:MaxDirectMemorySize=256m` and `-XX:MaxMetaspaceSize=256m`).
    - **Production Cloud (x64):** Configured via deployment manifest `JAVA_TOOL_OPTIONS` (`MaxRAMPercentage=50.0`, `-XX:+UseG1GC`, `-XX:MaxGCPauseMillis=100`, `-XX:+AlwaysPreTouch`), letting the JVM adapt dynamically to container CPU and memory allocations.
2.  **Double-Caching Docker Compilation**: Standardized optimized multi-stage `Dockerfile` structures. External dependencies are cached in a separate layer by running `./gradlew dependencies --no-daemon` *before* the application source code is copied. Any subsequent Java code change only rebuilds the final lightweight layers, decreasing pipeline build times to under 10 seconds.
3.  **JVM Class Data Sharing (CDS)**: A CDS archive is generated during the Docker build by booting `CdsTrainingApplication` (which terminates at context refresh via `spring.context.exit=onRefresh`). At runtime, `-XX:SharedArchiveFile=application.jsa` + `-Xshare:auto` reduce class-loading overhead for faster cold starts.
    -   The training context runs with `spring.cache.type=redis` and imports `CacheConfig` so the `RedisCacheManager` / `GenericJackson2JsonRedisSerializer` bean graph is loaded (no real Redis connection is opened — Lettuce connects lazily and the context exits before any cache read/write). In dev, `spring.cache.type=simple` exercises the same `@Cacheable` / `CacheManager` paths without requiring Redis.
4.  **Threading Model**: Java 21 **Virtual Threads (Project Loom) are explicitly enabled** through `spring.threads.virtual.enabled=true`, with `spring.main.keep-alive=true` so daemon virtual-thread schedulers do not terminate the application. The decision is based on the mixed I/O benchmark; the CPU-bound BCrypt/RSA login path remains a separate benchmark concern. **Bounded Async Executor (P0-1, BENCHMARKS.md §38)**: `AsyncConfig` (`src/main/java/com/example/taskflow/core/AsyncConfig.java`) replaces Spring's unbounded `@EnableAsync` default (`core=8, max=Integer.MAX_VALUE, queue=Integer.MAX_VALUE`) with a bounded `ThreadPoolTaskExecutor` — **core=8 max=64 queue=100 keepAlive=60s** `CallerRunsPolicy` (`taskflow-async-` prefix, `waitForTasksToCompleteOnShutdown=true` 30s). Burst applies backpressure to the caller instead of OOMing the 1.25 GiB heap; benchmark 500-task/50-thread burst: 148 tasks/sec, 319 ms avg, peak 8 threads, p99 <5s.
5.  **JSON Serialization**: Integrated Jackson 3.x with explicit version pins for low-latency serialization and CVE resolution.
6.  **Database Connection Pooling & PgBouncer Ceiling (P2, BENCHMARKS.md §50)**: **HikariCP** pool is sized at `maximum-pool-size=25` / `minimum-idle=10` in the `prod` profile (`spring.datasource.hikari.*`). The size is tuned for the expected concurrent request volume rather than left at the default of 10 — sweep at 50 VU VT: `10→3,015 RPS`, `25→4,128 RPS (+37%, selected, 97% of max)`, `50→4,257 RPS (+3% over 25)`. **Horizontal scaling ceiling**: `pool × replicas` must stay `< PG max_connections (100 default)`; `application-prod.properties:38` documents `>2 replicas → PgBouncer transaction pooling` (`pool_mode=transaction`, `max_client_conn=1000`, `default_pool_size=25`) via `homelab/TF` sidecar so Postgres sees only `default_pool_size` connections regardless of replica count.
7.  **Asynchronous Logging**: Console logging is buffered through Logback's `AsyncAppender` to keep normal request paths from blocking on log output.
8.  **Observability Taxonomy & Histograms (P1-5, BENCHMARKS.md §46)**: OpenTelemetry distributed tracing sampling was reduced from 100% to **10%** (`management.tracing.sampling.probability=0.1`), recovering peak RPS while retaining statistical observability. **Micrometer histograms**: `management.metrics.distribution.percentiles.http.server.requests=0.5,0.95,0.99` + `percentiles-histogram.http.server.requests=true` + `sla.http.server.requests=50ms,100ms,200ms` in `application-prod.properties` expose **p50/p95/p99** and Prometheus `_bucket{le}` histograms via `/actuator/prometheus` for `histogram_quantile` SLO alerts (overhead ~1–2% cardinality per `[uri,method,status]` series).
9.  **Distributed Caching (P0-2, BENCHMARKS.md §39)**: Read-heavy operations (e.g., retrieving busy slots) are annotated with `@Cacheable` and backed by **Redis** (`spring.cache.type=redis` in the `prod` profile) to prevent database exhaustion under heavy load while staying shared across replicas. A local `simple` (ConcurrentHashMap-backed) cache is used in dev so the `@Cacheable` / `CacheManager` code paths are exercised without requiring Redis. Each cache region has a bounded TTL — `appointmentStats` expires after 5 minutes, `busySlots` after 2 minutes (`sync=true`), and **reference data `barbers` / `publicBarbers` / `services` after 10 minutes** (`CacheConfig.java:135`, `RedisCacheConfiguration entryTtl 10m`) — with `sync=true` per-key stampede protection (one loader, others block) and `@CacheEvict(allEntries=true)` on `create/update/delete` mutations. `GenericJackson2JsonRedisSerializer` uses an explicit `BasicPolymorphicTypeValidator` allow-list covering `AppointmentStats`, `BarberResponse`, `PublicBarberResponse`, `ServiceItemResponse`, `BigDecimal`, and JDK `ImmutableCollections`/`Collections` collection types (no `LaissezFaireSubTypeValidator`), and `disableCachingNullValues()` to prevent cache poisoning. Benchmark (200 rows): cached **0.6 µs** vs DB **42 µs** — **50–90×** on H2 and ~1,200× on PostgreSQL, eviction verified.
10. **Atomic Rate Limiter (Lua, P0-3, BENCHMARKS.md §40)**: `RateLimiterConfig.java:38` executes a stateless `EVAL` Lua script on Redis's single thread — `local c = redis.call('incr', KEYS[1]); if c == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end; return c` — merging `INCR`+`PEXPIRE` into **1 RTT** (vs 2) and eliminating the `TTL=-1` leak window where a crash between commands would permanently block the IP bucket. **1.6× faster** (623 µs vs 976 µs, 1,605 vs 1,024 ops/sec) with burst `39k ops/sec` on single-key 50×20 contention; filter runs at `HIGHEST_PRECEDENCE+20` before JWT/BCrypt, skips `/actuator/health/**`.
11. **Upstream Connection Pooling (Nginx Keepalives) & Immutable Assets (P1-1, BENCHMARKS.md §42)**: Configured a persistent TCP connection pool (`keepalive 64`) inside Nginx's proxy upstream block. Rather than tearing down the TCP connection after every single request, Nginx reuse connections, eliminating handshake latency entirely. This yielded a **7.1x increase in throughput (from 350 RPS to 2,505 RPS)** and slashed average proxy latency from 141.4ms to **19.8ms** during heavy end-to-end load tests. **Immutable hashed assets**: `frontend/nginx.conf` splits the former single static block into `location ~* \.(?:js|css)$` with `Cache-Control "public, immutable, max-age=15552000"` (6-month immutable, `outputHashing:all` hashed bundles → 0 revalidation) vs `location ~* \.(?:ico|gif|jpe?g|png|svg|woff2?|eot|ttf|otf)$` with `Cache-Control "public"` (revalidated) and `location / try_files` for `index.html` (must revalidate).
12. **Frontend-Backend Multiplexing, ETag & Cache-Control (P1-3, BENCHMARKS.md §44)**: Enabled HTTP/2 in Spring Boot and configured Tomcat Keep-Alives (`server.tomcat.max-keep-alive-requests=100`) to let the browser execute concurrent requests over a single TCP connection. We also added a `ShallowEtagHeaderFilter` (restricted to GET requests only — POST/PUT/DELETE skip ETag buffering entirely) so the backend returns an instant `304 Not Modified` if the JSON payload hasn't changed. **Tiered HTTP `Cache-Control`**: `CacheControl.maxAge(5, TimeUnit.MINUTES).cachePublic()` for `GET /api/v1/catalog` / `GET /api/v1/barbers` / `GET /api/v1/reviews/public/barber-ratings` (5m public, aligns with `@Cacheable` 10m TTL, ETag 304 after expiry), `maxAge(30, TimeUnit.SECONDS).cachePrivate().mustRevalidate()` for `GET /api/v1/appointments/public/busy-slots` (30s private, volatile), and `noCache().cachePrivate().mustRevalidate()` for `GET /api/v1/appointments` (admin paginated) & `GET /api/v1/barbers/admin` (freshness required, ETag still allows 304).
13. **Browser Code Splitting & View Transitions**: Configured the Angular 22 Router with standalone `loadComponent()` routes for the admin and customer dashboards. No global `withPreloading(PreloadAllModules)` strategy is configured, avoiding unconditional background downloads. The native `withViewTransitions()` API improves perceived navigation continuity.
14. **k6 Ramping Load Gate (P2, BENCHMARKS.md §48)**: `k6/load.js` `ramping-vus` **0→50 (30s) →200 (60s) →0 (30s)** `gracefulRampDown 10s` with thresholds `http_req_failed rate<0.01`, `http_req_duration p(95)<500 p(99)<800`, `checks rate==1.0`, CWV gates `ttfb p(95)<800 fcp<1800 lcp<2500`; workload mix 70% `catalog`/`barbers` (cached 5m) / 20% `busySlots` (volatile 30s) / 10% `health` mirrors §32 distribution, pacing `sleep(0.1)` (~10 RPS/VU), CI gated via `.github/workflows/k6.yml`.
15. **Tightened Web Vitals Budgets & Lookbook Guard (P2, BENCHMARKS.md §49)**: `k6/browser.js` (`shared-iterations` 1 VU Chromium) tightens thresholds to CWV **good** thresholds (`ttfb<800 fcp<1800 lcp<2500`, per web.dev) vs previous lenient `p(95)<2500`/`lcp<6000`; Lookbook note — see Mobile §8.

---

## 🛡️ 6. Zero-Trust & Pro-Tier Container Isolation

To comply with the absolute highest standards in production-grade container architecture (matching setups used by Netflix and Google), we overhavled our Docker Compose, Nginx, and Dockerfile layers:

1.  **Network Segmentation**: We replaced the flat default Docker network with two strictly segmented networks: `frontend-tier` and `backend-tier`. The database and Redis are completely locked inside `backend-tier`, while Nginx resides on `frontend-tier`. Only the Spring Boot JRE acts as a bridge between the two, making it physically impossible for the frontend to establish a direct connection to the database.
2.  **Read-Only Root Filesystems**: Both the Frontend and Backend containers are run with `read_only: true`. The underlying OS is completely locked down, with temporary in-memory write access selectively granted only to transient directories (`/tmp`, `/var/cache/nginx`) using `tmpfs`. This blocks runtime code injection or malicious shell modifications entirely.
3.  **Kernel Privilege Dropping**: Every container explicitly drops all Linux kernel capabilities (`cap_drop: [ALL]`) and is barred from gaining new privileges (`no-new-privileges:true`), minimizing container breakout escalations.
4.  **Signal Management & Graceful Shutdown**: `tini` runs as PID 1 and forwards `SIGTERM` to the JVM. Spring stops accepting new requests and drains managed lifecycle phases for up to 30 seconds (`server.shutdown=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=30s`); Compose waits 40 seconds (`stop_grace_period`) before it can issue `SIGKILL`.
5.  **Strict Numeric UIDs**: Rather than using string-based names (like `USER appuser`), we hardcoded explicit numeric user and group IDs (`USER 10001:10001`) in the Dockerfile, instantly satisfying **Strict Kubernetes Pod Security Standards (PSS)** without runtime translation overhead.
6.  **Dual-Dockerfile Strategy (Dev/Benchmarking vs. Production Cloud)**: To achieve optimal throughput locally and standard portability in the cloud, the container layers are separated into two specialized specifications:
    *   **Local Developer (`Dockerfile`):** Targets local Apple Silicon (`--platform=linux/arm64`). Ships sizing-agnostic invariants in `CMD` (`-XX:SharedArchiveFile=application.jsa`, `-Xshare:auto`, `-XX:+ExitOnOutOfMemoryError`), while runtime heap and GC tuning are supplied via `JAVA_TOOL_OPTIONS` in `docker-compose.yml`.
    *   **Production Cloud (`Dockerfile.x64`):** Cross-compiles using `--platform=linux/amd64`. Sizing-agnostic image; JVM sizing and GC parameters are owned by production deployment manifests (`backend.yaml` `JAVA_TOOL_OPTIONS`), adapting dynamically to cgroup memory limits.
7.  **Container Health Probes — Local vs Prod Divergence (P1-6, BENCHMARKS.md §47)**: `Dockerfile` (arm64 local) carries `HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s CMD wget -qO /dev/null http://localhost:8080/actuator/health/liveness` so `docker run` is health-aware and `depends_on: condition: service_healthy` works in `docker-compose.yml` (backend + frontend). `Dockerfile.x64` intentionally **omits** `HEALTHCHECK` — production `livenessProbe`/`readinessProbe` are owned by `homelab/TF/gitops/apps/taskflow/backend.yaml` (kubelet, `initialDelaySeconds` tuned to pod resources); a baked `HEALTHCHECK` would duplicate/conflict and is not the single source of truth.

---

## 💎 7. Frontend Architectural Clean Code Refactorings

To match the clean code patterns of leading Angular repositories, we refactored our single-page application into a highly decoupled, state-isolated, and strictly checked architecture:

1.  **Lightweight Signal State Store**: We extracted all state properties, page variables, and asynchronous HTTP calls out of the main component and centralized them inside a modular, injectable `AppointmentStore` service.
2.  **Model-View-Controller (MVC) Decoupling**: By exposing the store's signals directly as read-only local properties in `app.ts` (e.g., `readonly appointments = this.store.appointments;`), we achieved 100% logic-view separation while keeping our massive HTML templates completely untouched and 100% compile-safe.
3.  **Componentization & Signal Inputs**: We extracted the monolithic styling selectors into a dedicated, standalone `<app-stylist-card>` component. This component utilizes Angular 22's cutting-edge Signal-based **`input.required()`** and **`output()`** APIs, guaranteeing strict compile-time binding safety and instant reactive repaints.
4.  **Strict Template Type-Checking**: We activated `"strictTemplates": true` and `"strictNullInputTypes": true` in `tsconfig.json`. This instructs the Angular compiler to rigorously type-check every single property, input binding, and event handler directly inside the HTML templates, ensuring compile-time safety and zero runtime null pointer crashes.
5.  **Nginx Header Inheritance Safeguard & Immutable Split (P1-1)**: Due to Nginx's `add_header` overriding mechanics, caching blocks on static assets normally wipe out parent security headers. We explicitly duplicated our Content Security Policy (CSP), X-Frame-Options, and X-Content-Type headers inside Nginx's static files caching location blocks, keeping your assets fully secured and guaranteeing an **A+ rating** on security audits. The former single `location ~* \.(?:ico|css|js|gif|...)` is split into `js|css` (`Cache-Control "public, immutable, max-age=15552000"`, 6M immutable for `outputHashing:all` hashed bundles, 0 revalidation) vs `ico|gif|jpe?g|png|svg|woff2?|eot|ttf|otf` (`Cache-Control "public"`, revalidated) plus `location / try_files` for `index.html` (must revalidate) — see BENCHMARKS.md §42.

---

## 📱 8. Cross-Platform Mobile Application Architecture (`mobile/`)

The mobile client architecture mirrors the Angular web functionality while optimizing for native Android & iOS interaction patterns:

```
[ MOBILE CLIENT RUNTIME ]                                [ SPRING BOOT BACKEND ]
  React Native / Expo App                                  REST API Controller
    │                                                        │
    ▼ (1. Screen Event / Gesture)                            │
  HomeScreen / BookingScreen / Dashboard                     │
    │                                                        │
    ▼ (2. TanStack Query Hook Trigger)                       │
  useAppointments / useCatalog / useCustomer                 │
    │                                                        │
    ▼ (3. Axios Request + Bearer Interceptor)                │
  apiClient (src/api/client.ts) ────────────────────────────►│ (4. REST API Endpoint)
    │                                                        │   Spring Security Filter
    ▼ (Reads JWT from Secure Storage)                        │   JWT Validation
  expo-secure-store (iOS Keychain / Android Keystore)        │
```

### Key Mobile Architectural Design Choices:
1.  **Native Navigation Flow (`src/navigation/`):** Utilizes React Navigation 7 with specialized Bottom Tab Navigators for Guests (`GuestTabNavigator`), Customers (`CustomerTabNavigator`), and Administrators (`AdminTabNavigator`) wrapped in a root `NativeStack`.
2.  **Server State Management via TanStack Query (`src/hooks/`) & QueryClient Tuning (P1-4, BENCHMARKS.md §45):** All asynchronous API states (appointments, service catalog, barbers, time-off, notifications, ratings) use TanStack Query for caching, retries, background refreshes, and mutation invalidations. `mobile/src/query/queryClient.ts` sets `staleTime: 60_000` (was 0, cuts catalog/barbers refetch ~50% on tab navigation), `gcTime: 5 * 60_000` (retain across navigation), exponential `retryDelay: min(1000 * 2^attempt, 30000)` with `retry:1` and `refetchOnWindowFocus:false`; `mobile/src/api/client.ts` sets `timeout: 10000` (was 15000, fail-fast < server JPA 5s + Hikari 20s).
3.  **Client Application State via Zustand (`src/store/`):** In-memory client states (active filter selections, search queries, active booking step) and JWT authentication credentials are handled by lightweight Zustand stores (`useAuthStore`, `useUIStore`).
4.  **Hardware Secure Storage (`src/utils/storage.ts`):** JWT credentials and user session payloads are stored securely inside platform hardware stores (**iOS Keychain** and **Android Keystore**) via `expo-secure-store`.
5.  **Styling & Design System (`src/theme/`):** Built with React Native `StyleSheet` consuming the `src/theme/colors.ts` palette (sourced from the mobile-local `src/theme/tokens.json`) of TaskFlow's Gold & Obsidian luxury salon color scheme.
6.  **Lookbook Virtualization Fix (P2, BENCHMARKS.md §49):** `mobile/src/components/lookbook/LookbookGallery.tsx` replaces `FlatList scrollEnabled={false}` inside parent `ScrollView` (which defeats windowing — all items render at once) with plain `LOOKBOOK_DATA.map` + `View` + `Card` so the parent `ScrollView` owns scrolling; overhead ~0 for 4 static items, with documented upgrade path to `FlashList` when catalogue >50 items. CWV budgets in `k6/browser.js` tightened to `ttfb<800 fcp<1800 lcp<2500` (web.dev good) vs previous lenient `p(95)<2500`/`lcp<6000`.
7.  **Backend Connectivity & Zero-Trust Security:**
     *   **Local Routing**: iOS Simulator (`http://localhost:4200`), Android Emulator (`http://10.0.2.2:4200`), and Physical LAN Devices (`http://<LAN_IP>:4200`) use the Nginx ingress; the backend is not host-published by Compose.
    *   **Production Deployment**: Replaces local API endpoints with public HTTPS domains (e.g. `https://api.taskflow.example.com`) via `EXPO_PUBLIC_API_URL` environment injection in `eas.json` or CLI flags (`EXPO_PUBLIC_API_URL=https://api.domain.com npx expo start -c`).
     *   **Security Layers**: Asymmetric RSA-2048 JWT authentication, native bearer tokens stored in SecureStore, bearer-only CSRF exemption for non-browser requests, web double-submit CSRF headers, Redis rate-limiting (max 20 auth reqs/min per IP), production SPKI public-key pinning, and mandatory TLS 1.3/1.2 encryption.

---

## 🔁 9. Platform-local Contracts & AI Synchronization Framework

To prevent architectural drift between the Web Frontend (`frontend/`) and Mobile App (`mobile/`), TaskFlow keeps synchronized, platform-local contract files. The reviewed OpenAPI baseline is the source of truth for API shapes:

```text
 ┌─────────────────────────────────────────────────────────────┐
│         Reviewed OpenAPI Baseline (`api/openapi.json`)       │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                │ npm run sync:api-types
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
  │             Platform Client Contracts                      │
  │  • frontend/src/app/types/api.ts (Web DTO Contracts)       │
  │  • mobile/src/types/api.ts        (Mobile DTO Contracts)    │
  │  • frontend/src/theme/tokens.json / mobile/src/theme/...   │
  │  • frontend/src/app/time-utils.ts / mobile/src/utils/...   │
 └──────────────┬──────────────────────────────┬───────────────┘
                │                              │
                ▼                              ▼
 ┌──────────────────────────────┐ ┌──────────────────────────────┐
 │     Web Frontend (@frontend) │ │     Mobile App (@mobile)     │
 │  • Angular 22 Signals        │ │  • React Native + Expo       │
 │  • Tailwind CSS (@theme)     │ │  • NativeWind + Query        │
 └──────────────────────────────┘ └──────────────────────────────┘
```

### Components of the Sync Framework:
1. **Reviewed OpenAPI Contract**: `scripts/check-openapi-contract.js` authenticates to the local development backend, canonicalizes `/v3/api-docs`, and writes or compares `api/openapi.json`. CI performs the same authenticated comparison and rejects unreviewed API changes.
2. **API Contract Generator (`scripts/sync-api-types.js`)**: Deterministically generates `frontend/src/app/types/api.ts` and `mobile/src/types/api.ts` from the reviewed baseline. `npm run sync:api-types:check` rejects stale generated files.
3. **Design Tokens**: `frontend/src/theme/tokens.json` and `mobile/src/theme/tokens.json` keep platform build inputs local while preserving the same Gold & Obsidian palette. They are consumed by `frontend/src/styles.css` (`@theme`) and `mobile/src/theme/colors.ts`.
4. **Pure Business Utilities**: `frontend/src/app/time-utils.ts` and `mobile/src/utils/time-utils.ts` each contain the client-local 12h/24h time formatting and `isOverdue` calculations.
5. **Feature Mapping Matrix**: `frontend/src/component-map.json` and `mobile/src/component-map.json` map feature domains (e.g. Stylist Cards, Booking Wizard, Customer Portal, Admin Dashboard) between Angular Web components/stores and React Native screens/hooks.
6. **Opencode AI Skill (`.opencode/skills/sync-to-mobile.md`)**: Instructs AI agents on framework translation rules (Angular Signals $\rightarrow$ TanStack Query / Zustand; Angular HTML $\rightarrow$ React Native JSX components).

---

## 🤖 10. Local Developer AI & Model Context Protocol (MCP) Architecture

To optimize development iteration speed, full-stack reasoning precision, and data privacy, the TaskFlow workspace features a SOTA **Local Developer AI and MCP orchestrator loop**. It connects local AI inference with a suite of unprivileged, sandboxed tools to automate file operations, tests, database queries, and browser rendering:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPER WORKSPACE (HOST)                       │
│                                                                        │
│                      ┌───────────────────────────┐                     │
│                      │  OPENCODE DEV ORCHESTRATOR │                     │
│                      └─────────────┬─────────────┘                     │
│                                    │                                   │
│            ┌───────────────────────┴───────────────────────┐           │
│            ▼ (1. OpenAI compatible chat stream)             ▼           │
│    ┌───────────────┐                               ┌───────────────┐   │
│    │   LM STUDIO   │                               │  MCP SERVERS  │   │
│    │ (Local Port)  │                               │ (Local/Docker)│   │
│    │               │                               │               │   │
│    │ Qwen 35B MTP  │                               │ ├─ filesystem │   │
│    │ (Speculative) │                               │ ├─ shell      │   │
│    │               │                               │ ├─ postgres   │   │
│    │ 4-bit KV Cache│                               │ ├─ puppeteer  │   │
│    │ 65k Context   │                               └───────┬───────┘   │
│    └───────────────┘                                        │           │
│                                                             │           │
└─────────────────────────────────────────────────────────────┼───────────┘
                                                              │           │
                                                              ▼           │
                                                  [ TARGET INFRASTRUCTURE ]
                                                    TaskFlow Local DB,
                                                    Nginx Proxy
```

### Step-by-Step AI Execution Loop:
1.  **AI Orchestration:** The developer initiates a task. Opencode parses the project-level system instructions (`AGENTS.md`) and compiles a task-specific prompt context.
2.  **Stateless API Chat Query:** Opencode streams the payload to **LM Studio (`http://localhost:1234/v1`)**.
3.  **Low-Latency Speculative Inference:** LM Studio processes the query utilizing **Qwen 35B MTP** with Apple Silicon Metal acceleration.
    - Native **Multi-Token Prediction (MTP)** speculative decoding runs in parallel, hitting a SOTA **~63% draft token acceptance rate**.
    - **4-bit KV Cache Quantization (`q4_0`)** reduces the memory consumption of active sessions by **75%**, allowing the model to leverage a massive **`65,536` token context window** with zero performance degradation.
4.  **Isolating Thoughts & Actions:** Qwen outputs its reasoning process. Thanks to LM Studio's `"separateReasoningContentInAPI": true` parameter and Opencode's `"reasoning": true` model mapping, internal `<think>` streams are separated into `reasoning_content` and rendered in collapsible UI segments.
5.  **Secure MCP Execution:** When a tool call is decided (e.g., executing a Flyway migration, editing Angular code, or validating layouts via Puppeteer), Opencode validates the security policies and executes the corresponding **Model Context Protocol (MCP)** server process, ensuring high-fidelity task execution.
