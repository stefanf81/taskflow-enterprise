# TaskFlow Enterprise Suite

**TaskFlow** is a modern, high-performance, full-stack appointment management and luxury salon booking platform.

The suite comprises three core components with platform-local contracts and design tokens:
1. **Spring Boot 4.1 Backend (Java 21):** REST API and admin SSE server providing business logic, OpenAPI specs, authentication, PostgreSQL persistence, Flyway migrations, and Redis caching.
2. **Angular 22 Web Frontend (`frontend/`):** Modern Angular Signals web application with Tailwind CSS gold & obsidian design system.
3. **React Native + Expo Mobile Application (`mobile/`):** Cross-platform native mobile application for Android (phones & tablets) and iOS (iPhone & iPad).
4. **Platform-local contracts:** The web and mobile clients each own their TypeScript API types, theme tokens, time utilities, and feature mapping metadata.

The web admin dashboard also subscribes to `GET /api/v1/appointments/events` using
cookie-authenticated Server-Sent Events. Events trigger a refresh of the existing
paginated REST query; they do not replace REST as the source of truth. The current
emitter registry is local to a backend instance, so multi-replica production needs
shared event fanout before relying on real-time updates across replicas.

---

## 🏛 Architecture Overview

```text
                               ┌──────────────────────────────────┐
                               │  Spring Boot 4.1 Backend REST    │
                               │        (Java 21 - Port 8080)     │
                                │      internal-only in Compose    │
                               └────────────────┬─────────────────┘
                                                │
                                                 │ Reviewed OpenAPI baseline
                                                 │ (`api/openapi.json`)
                                                ▼
                               ┌──────────────────────────────────┐
                                │     Platform Client Contracts   │
                                │   • frontend/src/app/types/api.ts│
                                │   • mobile/src/types/api.ts       │
                                │   • frontend/src/theme/tokens.json│
                                │   • mobile/src/theme/tokens.json │
                               └────────┬─────────────────┬───────┘
                                        │                 │
                  ┌─────────────────────┘                 └─────────────────────┐
                  ▼                                                             ▼
 ┌──────────────────────────────────┐                           ┌──────────────────────────────────┐
 │     Angular 22 Web Frontend      │                           │  React Native Mobile Application │
 │      (frontend/ - Port 4200)     │                           │     (mobile/ - Android & iOS)    │
 └──────────────────────────────────┘                           └──────────────────────────────────┘
```

**Performance & Reliability Highlights (P0–P2):** Bounded async executor `AsyncConfig` (core 8 / max 64 / queue 100 `CallerRunsPolicy`) → backpressure not OOM; atomic Redis Lua rate limiter (`EVAL` `INCR`+`PEXPIRE` 1 RTT, `HIGHEST_PRECEDENCE+20`); partial unique slot index `idx_appointment_slot_active` via `V21__fix_double_booking_index` (Postgres partial `WHERE status IN ('PENDING','APPROVED')` / H2 generated `active_slot_marker`); Redis `barbers`/`publicBarbers`/`services` caches (10 m TTL, `sync=true`, `@CacheEvict` on mutation) + `busySlots` 2 m; tiered `Cache-Control` (`5 m public` catalog/barbers/ratings, `30 s private` busySlots, `no-cache private` admin) + `ShallowEtagHeaderFilter` (GET only) + Tomcat `max-keep-alive-requests` 100 / Nginx `keepalive 64` + immutable hashed assets (`public, immutable, max-age=15552000` 6 M); Micrometer histograms `p50/p95/p99` + `sla 50/100/200 ms` + `percentiles-histogram true` via `/actuator/prometheus` (see `application-prod.properties`); explicit `-XX:+UseContainerSupport` + `-XX:+HeapDumpOnOutOfMemoryError`/`HeapDumpPath=/tmp/heapdump.hprof` + `-Xlog:gc*:file=/tmp/gc.log` diagnostics; local `Dockerfile` `HEALTHCHECK` (`30 s`/`5 s`/`3`/`15 s` `wget /actuator/health/liveness`) vs `Dockerfile.x64` probe-free for K8s `livenessProbe`; `k6/load.js` ramping-VUs `0→50→200→0` (`p95<500`/`p99<800`) + `k6/browser.js` CWV `ttfb<800 fcp<1800 lcp<2500`; mobile `queryClient` `staleTime 60 s`/`gcTime 5 m` + `timeout 10 s` fail-fast; PgBouncer ceiling docs (Hikari `25/10`, `pool×replicas < 100`, `>2 replicas → PgBouncer transaction`); Lookbook `FlatList scrollEnabled={false}` → `LOOKBOOK_DATA.map` fix.

---

## 📂 Project Structure

```text
.
├── src/                          # Spring Boot 4.1 Backend (Java 21 / Gradle)
│   ├── main/java/com/example/taskflow/
│   │   ├── appointment/          # Appointment domain, controllers, services
│   │   ├── auth/                 # RSA-2048 JWT authentication & security config
│   │   ├── catalog/              # Service catalog management
│   │   ├── core/                 # Shared configuration, errors, and rate limiting
│   │   ├── notification/         # Notification outbox relay
│   │   └── review/               # Barber ratings & review management
│   └── main/java/db/migration/   # Java-based Flyway migrations
├── frontend/                     # Angular 22 Web Application (TypeScript / Tailwind CSS)
│   ├── src/app/                  # Angular components, signals, stores, services
│   └── nginx.conf                # Production Nginx reverse proxy configuration
├── mobile/                       # React Native + Expo Cross-Platform Mobile Application
│   ├── src/
│   │   ├── api/                  # Axios REST API client
│   │   ├── components/           # Reusable mobile UI components
│   │   ├── hooks/                # TanStack Query custom hooks
│   │   ├── navigation/           # React Navigation (Guest, Customer, Admin tabs)
│   │   ├── screens/              # HomeScreen, BookingScreen, CatalogScreen, etc.
│   │   ├── store/                # Zustand store (useAuthStore)
│   │   └── utils/                # expo-secure-store wrapper
│   ├── app.json                  # Expo App configuration
│   └── eas.json                  # EAS Build profiles (Android APK/AAB, iOS IPA)
├── frontend/src/                 # Web-owned contracts, theme, utilities, and map
│   ├── app/types/api.ts          # Web API contracts (OpenAPI aligned)
│   ├── app/time-utils.ts         # Web 12h/24h time formatting and date logic
│   ├── theme/tokens.json         # Web Obsidian & Gold theme tokens
│   └── component-map.json        # Cross-platform Web ↔ Mobile feature mapping
├── mobile/src/                   # Mobile-owned contracts, theme, utilities, and map
│   ├── types/api.ts              # Mobile API contracts (OpenAPI aligned)
│   ├── utils/time-utils.ts       # Mobile 12h/24h time formatting and date logic
│   ├── theme/tokens.json         # Mobile Obsidian & Gold theme tokens
│   └── component-map.json        # Cross-platform Web ↔ Mobile feature mapping
├── api/openapi.json              # Reviewed, canonical OpenAPI contract baseline
├── scripts/                      # Workspace utility scripts
│   ├── check-openapi-contract.js # Compares a live spec with the baseline
│   └── sync-api-types.js         # Deterministic OpenAPI-to-TypeScript generator
├── .opencode/skills/             # AI Developer Agent Workflows
│   └── sync-to-mobile.md         # Angular Web → React Native Mobile sync skill
├── package.json                  # Root monorepo workspace scripts
├── docs/                         # Architectural Decision Records (ADRs)
│   └── adr/
├── docker-compose.yml            # Local Docker orchestrator (JAVA_TOOL_OPTIONS: UseContainerSupport, HeapDump, GC log, G1GC 50% heap)
├── Dockerfile                    # arm64 local — sizing-agnostic + HEALTHCHECK (30s/5s/3/15s liveness); x64 prod image omits it (K8s probe)
├── Dockerfile.x64                # amd64 prod — sizing-agnostic, no HEALTHCHECK (K8s livenessProbe owns it)
├── k6/load.js                    # k6 ramping-VUs 0→50→200→0 load gate (p95<500, p99<800, checks 1.0)
├── k6/browser.js                 # k6 browser CWV gate (ttfb<800 fcp<1800 lcp<2500, Lookbook wizard)
├── start-docker.sh               # One-click Docker launcher script
├── stop-docker.sh                # Docker cleanup script
├── verify.sh                     # Full-stack quality verification (with auto-docker lifecycle)
└── ARCHITECTURE.md               # End-to-End Architectural Blueprint
```

**P0–P2 Structures & Tunings (see `ARCHITECTURE.md` / `BENCHMARKS.md`):**

- `core/AsyncConfig.java` — bounded `ThreadPoolTaskExecutor` `core=8 max=64 queue=100 CallerRunsPolicy` (`taskflow-async-` prefix, 30 s graceful) replaces unbounded `@EnableAsync` default.
- `core/RateLimiterConfig.java` — stateless Redis Lua `EVAL` (`INCR`+`PEXPIRE` 1 RTT, `HIGHEST_PRECEDENCE+20`, skips `/actuator/health/**`).
- `db/migration/V21__fix_double_booking_index.java` — partial unique `idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time) WHERE status IN ('PENDING','APPROVED')` (Postgres partial; H2 via generated `active_slot_marker INTEGER AS (CASE WHEN status IN ('PENDING','APPROVED') THEN 1 ELSE NULL END)` + `UNIQUE(... marker)`).
- `core/CacheConfig.java` + `appointment/BarberServiceImpl.java` / `catalog/CatalogServiceImpl.java` / `appointment/BusySlotsService.java` — Redis-backed `@Cacheable(barbers/publicBarbers/services sync=true, 10 m)` / `busySlots (2 m, sync=true)` with `@CacheEvict(allEntries=true)` on mutations; `GenericJackson2JsonRedisSerializer` explicit allow-list; tiered `Cache-Control` in controllers (`5 m public` catalog/barbers/ratings, `30 s private` busySlots, `no-cache private` admin) + `ShallowEtagHeaderFilter` (GET only).
- `frontend/nginx.conf` — upstream `keepalive 64` + split static caching (`js|css` → `Cache-Control "public, immutable, max-age=15552000"` 6 M, `ico|gif|jpe?g|png|svg|woff2?` → `Cache-Control "public"`), `index.html` via `try_files` (must-revalidate), security headers duplicated into cache blocks.
- `src/main/resources/application-prod.properties` — Micrometer `management.metrics.distribution.percentiles.http.server.requests=0.5,0.95,0.99` + `percentiles-histogram=true` + `sla=50ms,100ms,200ms` (`/actuator/prometheus` histograms), Hikari `maximum-pool-size=25/minimum-idle=10` + PgBouncer ceiling comment (`pool×replicas < 100`, `>2 → PgBouncer transaction`).
- `docker-compose.yml` & `homelab/TF/gitops/apps/taskflow/backend.yaml` `JAVA_TOOL_OPTIONS` — explicit `-XX:+UseContainerSupport` (cgroup-aware, self-documenting), `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heapdump.hprof`, `-Xlog:gc*:file=/tmp/gc.log:time,uptime:filecount=3,filesize=10m` (3×10 MB), plus `UseG1GC`/`MaxGCPauseMillis=100`/`AlwaysPreTouch`/`MaxDirectMemorySize|Metaspace 256m`.
- `k6/load.js` (`ramping-vus` `0→50 30 s →200 60 s →0 30 s`, `gracefulRampDown 10 s`, thresholds `http_req_failed rate<0.01`, `p95<500 p99<800`, `checks 1.0`; workload `70% catalog/barbers /20% busySlots /10% health`, `sleep 0.1`) + `k6/browser.js` (`shared-iterations` 1 VU Chromium Lookbook→stylist→slot→form, Core Web Vitals thresholds `ttfb<800 fcp<1800 lcp<2500`).
- `mobile/src/query/queryClient.ts` (`staleTime 60_000` was 0, `gcTime 5*60_000`, `retry:1` exponential `retryDelay` `min(1000*2^attempt,30000)`, `refetchOnWindowFocus:false`) + `mobile/src/api/client.ts` (`timeout 10000` was 15000, fail-fast < JPA 5 s+Hikari 20 s); `mobile/src/components/lookbook/LookbookGallery.tsx` — `FlatList scrollEnabled={false}` inside `ScrollView` → `LOOKBOOK_DATA.map` + `View` + `Card` (parent `ScrollView` owns scroll; `FlashList` >50 items).

---

## 🚀 Workspace Commands

| Command | Description |
| :--- | :--- |
| `npm run sync:api-types` | Generates both platform API type files from the reviewed `api/openapi.json` baseline |
| `npm run sync:api-types:check` | Fails if either generated platform API type file is stale |
| `npm run api:spec:update` | Authenticates to a running local backend and refreshes the reviewed OpenAPI baseline after an intentional API change |
| `npm run api:spec:check` | Validates the checked-in OpenAPI baseline is canonical JSON |
| `npm run test:all` | Executes test suites across both Angular Web (`frontend/`) and React Native Mobile (`mobile/`) |
| `npm run lint:all` | Performs TypeScript static type checks across both projects |
| `./start-docker.sh` | Launches PostgreSQL, Redis, Spring Boot backend, and Nginx frontend in health-checked Docker stack |
| `./stop-docker.sh` | Safely tears down local Docker stack |
| `./verify.sh` | Full-stack end-to-end verification check |

---

## 🚀 Quick Start Guide

### 1. Run via Docker Compose (Full Stack)
```bash
./start-docker.sh
```
This launches the PostgreSQL database, Redis cache, Spring Boot backend, and Nginx frontend in health-checked isolated Docker networks.

* **Web UI:** `http://localhost:4200` — hashed `js|css` served `immutable, max-age=15552000` (6 M), other assets `public`, `index.html` must-revalidate.
* **API via Nginx:** `http://localhost:4200/api` — tiered `Cache-Control` (`public max-age=300` catalog/barbers/ratings, `private max-age=30` busySlots, `no-cache private` admin) + `ETag` `304` on GETs, HTTP/1.1 upstream proxying with `keepalive 64` connection reuse.
* **Prometheus Metrics:** Internal backend endpoint requiring ADMIN authentication — JWT cookie or bearer token — at `/actuator/prometheus`; `application-prod.properties` exposes Micrometer histograms `p50/p95/p99` + `sla 50/100/200ms` + `percentiles-histogram` for `histogram_quantile` SLO queries (see `BENCHMARKS.md §46`). Health probes at `/actuator/health/liveness` & `/readiness` (local `Dockerfile` `HEALTHCHECK` `wget`; prod uses K8s probes).
* **Stop Application Stack:** `./stop-docker.sh`
* **Full-Stack Automated Verification:** `./verify.sh` (automatically starts Docker if needed and cleans up on exit)
* **Load Gate (P2):** `k6/load.js` ramping `0→50→200→0` (`p95<500 ms`, `p99<800 ms`, `checks 1.0`) — workload mirrors prod `70% catalog/barbers /20% busySlots /10% health`; run via `.github/workflows/k6.yml`. Browser CWV gate via `k6/browser.js` (`ttfb<800 fcp<1800 lcp<2500`).

---

### 2. Run Mobile Application (`mobile/`)

```bash
cd mobile

# Install dependencies
npm install

# Start Expo Metro Bundler
npm start

# Run on Android Emulator or physical device
npm run android

# Run on iOS Simulator or physical device
npm run ios

# Run Jest test suite
npm test
```

* **Query Tuning (P1-4):** `mobile/src/query/queryClient.ts` uses `staleTime 60_000` / `gcTime 5*60_000` with exponential `retryDelay` (`retry:1`, `refetchOnWindowFocus:false`) — cuts catalog/barbers refetch ~50% on tab navigation vs `staleTime 0`. `mobile/src/api/client.ts` `timeout 10000` (was 15000, fail-fast < server JPA 5 s + Hikari 20 s). `LookbookGallery` uses `LOOKBOOK_DATA.map` (not `FlatList scrollEnabled={false}`) so parent `ScrollView` owns scrolling; upgrade to `FlashList` when catalogue >50.

---

### 3. Run Backend Locally (Spring Boot)

```bash
./gradlew bootRun
```
* Uses embedded H2 database by default in `dev` profile.
* Listens on `http://localhost:8080`.

---

### 4. Run Web Frontend Locally (Angular 22)

```bash
cd frontend
npm install
npm start
```
* Dev server runs on `http://localhost:4200` and proxies `/api` requests to `http://localhost:8080`.

---

## 🛡️ Security & Container Hardening

* **Numeric UIDs:** Backend containers run as unprivileged numeric user `10001:10001` complying with strict Kubernetes Pod Security Standards (PSS).
* **Zero-Trust Networks:** Docker Compose isolates PostgreSQL and Redis on `backend-tier`. Nginx lives on `frontend-tier`. Only Spring Boot bridges both.
* **Single Public Ingress:** Docker Compose exposes only Nginx. The backend is reachable internally at `backend:8080` and receives normalized forwarding headers from Nginx.
* **Read-Only Filesystems:** Containers run with `read_only: true` with ephemeral `/tmp` mounted as `tmpfs`.
* **Dropped Kernel Capabilities:** All containers explicitly execute with `cap_drop: [ALL]` and `no-new-privileges:true`.
* **Graceful Shutdown:** Spring Boot drains requests for up to 30 seconds (`server.shutdown=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=30s`). The backend Compose service waits 40 seconds before Docker escalates SIGTERM to SIGKILL.
* **Container Lifecycle:** Services use `restart: "no"` in `docker-compose.yml` to prevent lingering background containers. Verification and test scripts (`./verify.sh`, `npm run e2e:docker`) register exit traps to automatically stop containers upon completion.
* **Hardware Token Security:** Mobile app stores JWT tokens in **iOS Keychain** & **Android Keystore** via `expo-secure-store`.
* **HttpOnly Cookies:** Web app uses `HttpOnly`, `SameSite=Strict` cookies with double-submit CSRF token protection.
* **Native Mobile Auth:** Mobile uses `POST /api/v1/auth/mobile/login` and sends the SecureStore token as an `Authorization: Bearer` header; it does not depend on native cookie persistence.
* **Admin SSE Auth:** The web admin event stream uses the existing HttpOnly `access_token` cookie. The JWT is never read by JavaScript or passed in an SSE URL.
* **Tiered Cache-Control & ETag (P1-3):** `GET /api/v1/catalog` / `barbers` / `reviews/public/barber-ratings` → `Cache-Control: public, max-age=300` (5 m, aligns with 10 m `@Cacheable` + `304` via `ShallowEtagHeaderFilter` GET-only); `busySlots` → `private, max-age=30, must-revalidate`; admin `GET /appointments` / `barbers/admin` → `private, no-cache, must-revalidate` (ETag still allows `304`). Nginx additionally serves hashed `js|css` as `public, immutable, max-age=15552000` (6 M) for `outputHashing:all` bundles.
* **Observability Histograms (P1-5):** `application-prod.properties` configures `management.metrics.distribution.percentiles=0.5,0.95,0.99` + `percentiles-histogram=true` + `sla=50ms,100ms,200ms`. Prometheus scrapes `/actuator/prometheus` for `http_server_requests_seconds{quantile}` and `_bucket{le}` — use `histogram_quantile(0.95, …)` for SLO alerts (overhead ~1–2% cardinality). OTel tracing remains at 10% sampling.
* **Mobile Query Tuning (P1-4):** `mobile/src/query/queryClient.ts` sets `staleTime 60_000` (was 0, cuts catalog/barbers refetch ~50% on tab nav), `gcTime 5*60_000` (retain across nav), exponential `retryDelay` with `retry:1`, `refetchOnWindowFocus:false`; `mobile/src/api/client.ts` `timeout 10000` (< JPA 5 s + Hikari 20 s, fail-fast). `LookbookGallery` virtualization fix (`FlatList`+`scrollEnabled=false` → plain `map`) prevents windowing defeat.
* **Container Diagnostics (P1-2):** `JAVA_TOOL_OPTIONS` carries explicit `-XX:+UseContainerSupport` (cgroup-aware, self-documenting), `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heapdump.hprof` (0% until OOM, `tmpfs` `/tmp`), `-Xlog:gc*:file=/tmp/gc.log:time,uptime:filecount=3,filesize=10m` (3×10 MB rotation, ~0.7% overhead). `Dockerfile` (local) now has `HEALTHCHECK` (`wget /actuator/health/liveness`); `Dockerfile.x64` omits it — K8s `livenessProbe`/`readinessProbe` in `homelab/TF` is the source of truth.
* **PgBouncer Ceiling (P2):** `application-prod.properties:38` documents Hikari `maximum-pool-size=25/minimum-idle=10` knee curve (`10→3015 RPS`, `25→4128 RPS`, `50→4257 RPS`) and `pool×replicas < PG max_connections (100)`; `>2 replicas → PgBouncer transaction pooling` sidecar (`homelab/TF/gitops/apps/taskflow/backend.yaml`).

---

## 📦 Dependency Updates

Renovate runs daily and can also be started manually from GitHub Actions. Patch
and minor updates automerge only after the protected `main` branch's required
CI checks succeed; major, pin, digest, and lock-file-maintenance updates remain
reviewable pull requests.

Version-coupled stacks are grouped into reviewable PRs and never automerged:

* Angular framework, CLI/build tooling, RxJS, and TypeScript.
* Spring Boot plugin and dependency BOM.
* Flyway, Hibernate, Netty, Log4j, and Jackson coordinated dependencies.
* React Navigation and React Native test tooling.

Expo owns the compatibility matrix for native modules. Renovate excludes only
the explicitly named Expo, React, React Native, and native test dependencies in
`mobile/package.json`; it does not automatically discover every SDK-compatible
native module. Add a new native module with `npx expo install <package>`, then
run `npx expo install --check`. When upgrading Expo SDK, first select the target
`expo` version, then run `npx expo install --fix` and `npx expo-doctor`. See
[CI documentation](.github/workflows/ci.md) for the required checks and
Renovate authentication details.

---

## 📚 Documentation & ADRs

* [ARCHITECTURE.md](ARCHITECTURE.md) — Detailed end-to-end data flow and architectural analysis
* [AGENTS.md](AGENTS.md) — Developer guidelines and AI agent instructions
* [SYSTEM-HARDENING.md](SYSTEM-HARDENING.md) — Zero-trust security & container hardening policy
* [mobile/development-set.md](mobile/development-set.md) — Mobile development setup, testing, and release workflow
* [docs/adr/README.md](docs/adr/README.md) — Architecture Decision Records (ADRs) — full index
  * `ADR-001` — Virtual Threads — Enabled Explicitly
  * `ADR-002` — ParallelGC vs G1GC (Superseded)
  * `ADR-003` — Denormalized Customer Name
  * `ADR-004` — Redis for Distributed Caching
  * `ADR-005` — JWT in HttpOnly Cookie
  * `ADR-006` — Migration to React Native & Expo Mobile Application
  * `ADR-007` — Dedicated Mobile Bearer Authentication
  * `ADR-008` — Reviewed OpenAPI Contract Baseline
  * `ADR-009` — Admin Appointment Updates via Server-Sent Events
  * `ADR-010` — Bounded Async Executor
  * `ADR-011` — Reference Data Caching (Barbers & Services)
  * `ADR-012` — Lua-Atomic Rate Limiter
  * `ADR-013` — Partial Unique Slot Index (Anti Double-Booking)
