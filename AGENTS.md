# TaskFlow — Agent Instructions

## Project Structure

- **Backend**: Spring Boot 4.1.1 / OpenJDK 21 / Gradle — `src/main/java/com/example/taskflow/`
  - High-Performance Tunings: Container-portable heap sizing (deployment-owned via `JAVA_TOOL_OPTIONS`), Virtual Threads explicitly ENABLED (`spring.threads.virtual.enabled=true`, with `spring.main.keep-alive=true`; see BENCHMARKS.md §32), Jackson 3, Lazy Connection Fetching, Asynchronous Logging, OpenTelemetry 10% sampling, Redis-backed caching (Spring Cache abstraction) + **P0–P2**: bounded async executor `AsyncConfig` (`core=8 max=64 queue=100 CallerRunsPolicy`, `taskflow-async-` 30 s graceful) replaces unbounded default (BENCHMARKS.md §38); tiered `Cache-Control` + `ShallowEtagHeaderFilter` (GET-only) + Nginx `keepalive 64` & immutable hashed assets (`public, immutable, max-age=15552000` 6 M) (§42/§44); Micrometer histograms `p50/p95/p99` + `sla 50/100/200ms` + `percentiles-histogram` at `/actuator/prometheus` (§46); explicit `-XX:+UseContainerSupport` + heap-dump `/tmp/heapdump.hprof` + GC log `/tmp/gc.log` diagnostics (§43); mobile `queryClient` `staleTime 60_000`/`gcTime 5*60_000` + `timeout 10000` (§45); PgBouncer ceiling docs Hikari `25/10`, `pool×replicas<100`, `>2→PgBouncer transaction` (§50); Lookbook `FlatList scrollEnabled={false}`→`map` virtualization fix (§49).
  - Runtime Profiles & Multi-Arch JVM Optimization:
    - **JVM sizing is deployment-owned.** Both Dockerfiles' image CMDs are sizing-agnostic: they carry only environment-invariant flags (`-XX:SharedArchiveFile=application.jsa`, `-Xshare:auto`, `-XX:+ExitOnOutOfMemoryError`). Heap / off-heap / GC behavioral tuning live in `JAVA_TOOL_OPTIONS` of the runtime environment, NOT the image. Setting sizing in the CMD would silently win over the deployment env (JVM last-wins precedence for non-sticky flags) and recreate the precedence bug where the deployment's tuning was a no-op.
    - **Local (Apple Silicon M4 Pro):** Native `Dockerfile` (`--platform=linux/arm64`) ships only runtime invariants. Heap / off-heap sizing and behavioral GC flags are set via `JAVA_TOOL_OPTIONS` in `docker-compose.yml` (50% × 2560M limit ≈ 1.25 GiB heap, G1GC + AlwaysPreTouch + MaxDirectMemorySize=256m + MaxMetaspaceSize=256m).
    - **Production (AMD Ryzen 5 7430U):** Cross-compiled via `Dockerfile.x64` (`--platform=linux/amd64`). The image is sizing-agnostic; JVM sizing is owned by `homelab/TF/gitops/apps/taskflow/backend.yaml` `JAVA_TOOL_OPTIONS`: `MaxRAMPercentage=50.0` (50% × 2Gi = 1 GiB heap, leaving 1 GiB for off-heap), `MaxDirectMemorySize=256m`, `MaxMetaspaceSize=256m`, plus behavioral GC flags (G1GC, `MaxGCPauseMillis=100`, AlwaysPreTouch) and heap-dump-on-OOM. CPU-pinned GC/AVX flags are deliberately omitted so the JVM reads the container's actual CPU allocation.
    - **Healthcheck Divergence (P1-6 §47):** Local `Dockerfile` carries `HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s CMD wget -qO /dev/null http://localhost:8080/actuator/health/liveness` for standalone `docker run` & `depends_on: condition: service_healthy`. `Dockerfile.x64` intentionally omits `HEALTHCHECK` — K8s `livenessProbe`/`readinessProbe` in `homelab/TF/gitops/apps/taskflow/backend.yaml` is the source of truth.
    - **Production manifests live in a separate repo** (`homelab/TF/gitops/apps/taskflow/`), not in this workspace.
  - Packages: `appointment` (`BarberServiceImpl`/`BusySlotsService` + V21 partial index), `auth`, `catalog` (`CatalogServiceImpl` caching), `core` (`AsyncConfig` bounded executor, `RateLimiterConfig` Lua `EVAL`, `CacheConfig` 10m/2m TTLs, `CacheControl`/`ShallowEtagHeaderFilter`), `notification`, `review`
  - Entry point: `TaskflowApplication.java`
- **Frontend**: Angular 22 / TypeScript / Tailwind CSS — `frontend/`
  - Entry: `frontend/src/main.ts`, app module: `frontend/src/app/`
  - Auth: Stateless JWT in an HttpOnly `access_token` cookie (RSA-2048 asymmetric, OAuth2 Resource Server). `auth.interceptor.ts` catches 401s; `auth.guard.ts` is a `canActivateFn` that gates the `/admin` and `/customer` dashboards. The principal's role is restored from the backend via `GET /api/v1/auth/me` (reads the cookie) into an **in-memory** signal (`AuthState`) — it is never trusted from `sessionStorage`/`localStorage`.
  - CSRF: Double-submit pattern. The backend sets a readable `XSRF-TOKEN` cookie (via `CookieCsrfTokenRepository.withHttpOnlyFalse()`). Angular's `withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' })` in `app.config.ts` reads that cookie and attaches the header automatically on state-changing requests. The JWT `access_token` cookie is HttpOnly and **never** read by JavaScript — do not confuse the two. CSRF is disabled on public guest endpoints (`POST /api/v1/appointments`, `PUT /api/v1/appointments/public/cancel/*`, `POST /api/v1/reviews/public/**`).
- **Mobile**: React Native / Expo / TypeScript — `mobile/`
  - Entry: `mobile/App.tsx`, source: `mobile/src/`
  - Navigation: React Navigation (Guest, Customer, and Admin tab navigators inside Root NativeStack).
  - State: TanStack Query (`@tanstack/react-query`) for server state, Zustand (`useAuthStore`) for client state.
  - Security: Native bearer login via `POST /api/v1/auth/mobile/login`, bearer tokens stored via `expo-secure-store` (iOS Keychain / Android Keystore), and no reliance on a native cookie jar. Bearer-only state-changing requests are CSRF-exempt; web cookie requests retain double-submit CSRF protection.
  - Builds: EAS Build configured via `mobile/eas.json` for Android (APK/AAB) and iOS (Simulator/IPA).
- **Platform-local contracts**:
  - `api/openapi.json`: reviewed, canonical OpenAPI contract baseline.
  - `frontend/src/app/types/api.ts` and `mobile/src/types/api.ts`: generated API DTO contracts synchronized from the baseline.
  - `frontend/src/theme/tokens.json` and `mobile/src/theme/tokens.json`: Obsidian & Gold design system tokens.
  - `frontend/src/app/time-utils.ts` and `mobile/src/utils/time-utils.ts`: Pure 12h/24h time and date utilities.
  - `frontend/src/component-map.json` and `mobile/src/component-map.json`: Cross-platform feature component mapping metadata.
- **DB**: SQL Flyway migrations in `src/main/resources/db/migration/`; Java-based migrations in `src/main/java/db/migration/`

## Cross-Platform AI Feature Synchronization Workflow

When modifying or porting a feature between Web (`frontend/`) and Mobile (`mobile/`):
1. **Lookup Component Mapping**: Inspect `frontend/src/component-map.json` or `mobile/src/component-map.json` to identify target files on both platforms.
2. **Use Opencode Sync Skill**: Reference `.opencode/skills/sync-to-mobile.md` for exact framework translation rules:
   * **State**: Angular Signals (`signal()`, `computed()`) $\rightarrow$ TanStack Query (`useQuery`) / Zustand (`useAuthStore`).
   * **Templates**: Angular `@if`/`@for` $\rightarrow$ React Native JSX conditionals & `FlatList`/`map()`.
   * **Theme**: Ensure color tokens originate from the platform-local token files (`mobile/src/theme/colors.ts`).
3. **Sync API Contracts**: If backend endpoints/DTOs change, start the backend, run `npm run api:spec:update`, then `npm run sync:api-types`. Commit the baseline and both generated client type files. Run `npm run sync:api-types:check` before finishing.
4. **Verify**: Run `npm run lint:all` and `npm run test:all`.

## Commands

### Monorepo Workspace Commands (root)
```bash
npm run api:spec:update      # refresh the reviewed baseline from a running local backend
npm run api:spec:check       # validate the canonical baseline file
npm run sync:api-types       # generate both platform API types from the baseline
npm run sync:api-types:check # fail when generated platform API types are stale
npm run test:all         # run unit tests across both Angular Web and React Native Mobile
npm run lint:all         # run TypeScript type check on mobile and web
```

### Backend (root)
```bash
./gradlew build          # compile + test
./gradlew test           # unit + H2-backed integration tests
./gradlew testcontainersTest # tagged PostgreSQL integration tests (requires Docker)
./gradlew check          # test + OWASP dependency check (fails on CVSS >= 7)
./gradlew bootJar        # build production JAR
./gradlew bootRun        # run backend locally (uses H2 by default)
```

### Frontend (`frontend/`)
```bash
npm start                # Angular dev server on :4200
npm test                 # unit tests (vitest via Angular builder)
npm run e2e              # Playwright E2E (spins up dev server via webServer config)
npm run e2e:docker       # Playwright E2E with full Docker stack spin-up and auto-teardown
npm run build            # production build
```

### Mobile (`mobile/`)
```bash
npm start                # Start Expo Metro Bundler
npm run android          # Run on Android Emulator or connected device
npm run ios              # Run on iOS Simulator or connected device
npm test                 # Run Jest unit & component tests (>70% coverage enforced)
npm run e2e:build:android # Build Release APK & Test APK for Detox E2E
npm run e2e:test:android  # Run Detox E2E tests on Android Emulator (100% PASS)
npm run e2e:build        # Build Release App for iOS Simulator Detox E2E
npm run e2e:test         # Run Detox E2E tests on iOS Simulator
```

### Developer Environment
```bash
./update-mcp.sh          # High-performance, concurrent OpenCode MCP and developer tool updater (Go, NPM, uv). Uses strict mode and atomic execution locks.
```

### Local AI & Developer Agent Stack (LM Studio & Opencode)

To maintain absolute data privacy, cost efficiency, and low-latency development iteration, the coding agents are backed by a local, high-performance LLM stack run via **LM Studio** and orchestrated by **Opencode**.

*   **Primary Reasoning Model:** Qwen 35B MTP (`qwen3.6-35b-a3b-mtp`), loaded with native Multi-Token Prediction (MTP) speculative decoding for extremely high inference speeds.
*   **API Protocol:** OpenAI-compatible local endpoint on `http://localhost:1234/v1`.
*   **UI Integration & Collapsible Thoughts:** The model is configured inside `~/.config/opencode/opencode.jsonc` with `"reasoning": true` to separate internal `<think>` reasoning strings from the final coding outputs. Opencode renders these steps in native collapsible panels.
*   **Credentials Hardening:** Plaintext API keys or tokens are banned in configurations. The GitHub Personal Access Token is dynamically injected via Opencode's env substitution: `"GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_PERSONAL_ACCESS_TOKEN}"`.
*   **Configuration Backups:** 
    - Opencode LLM parameters: Saved in `llm-config.json` (external to repo)
    - LM Studio Model loading parameters: Saved in `lmstudio-qwen-config.json` (external to repo)

### Full-stack Docker
```bash
./start-docker.sh        # docker compose up (db → backend → frontend, health-checked)
./stop-docker.sh         # docker compose down
./verify.sh              # full-stack quality check (auto-starts Docker if needed, cleans up on exit)
```

### Security
Security scans (filesystem lints, container image vulnerability scans, and DAST OpenAPI security scans) are automated and executed directly within GitHub Actions to maintain lightweight local environments.

## Key Conventions

- **DB**: H2 in dev/test, PostgreSQL in prod (docker-compose / K8s). Flyway handles migrations — never use `ddl-auto=update`. All profiles use `ddl-auto=validate`.
- **Container Hardening & Zero-Trust**:
  - **Numeric UIDs**: Backend containers are configured with a hardcoded, unprivileged numeric UID (`10001:10001`) to comply with strict Kubernetes Pod Security Standards (PSS).
  - **Zero-Trust Networks**: `docker-compose.yml` isolates the DB and Cache on the `backend-tier` network. The Nginx reverse proxy is on the `frontend-tier`. The backend bridges both. The frontend cannot physically talk to the database.
  - **Read-Only Root**: Containers mount read-only filesystems with ephemeral directories mounted as `tmpfs` (e.g., `/tmp`, `/var/cache/nginx`), preventing runtime binary tampering.
  - **Dropped Capabilities**: All services completely drop kernel privileges (`cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`).
  - **Container Lifecycle**: `docker-compose.yml` uses `restart: "no"` so containers do not linger across system/Docker reboots. Verification and E2E scripts (`./verify.sh`, `npm run e2e:docker`) use exit traps (`./stop-docker.sh`) to automatically stop containers after test completion.
  - **Graceful Shutdown**: Spring drains for 30 seconds (`server.shutdown=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=30s`) and the Compose backend has a 40-second `stop_grace_period`. Keep production `terminationGracePeriodSeconds` longer than the Spring shutdown phase in the separate GitOps repository.
- **OSIV is off** (`spring.jpa.open-in-view=false`) — connections return to Hikari pool immediately after service methods.
- **Bounded Async Executor (P0-1 §38)**: `core/AsyncConfig.java` replaces Spring's unbounded `@EnableAsync` default (`core=8 max=Integer.MAX_VALUE queue=Integer.MAX_VALUE`) with bounded `ThreadPoolTaskExecutor` `core=8 max=64 queue=100 CallerRunsPolicy` (`taskflow-async-` 30 s graceful) — burst backpressures caller instead of OOMing the 1.25 GiB heap.
- **Partial Unique Slot Index (P0-4 V21 §41)**: `db/migration/V21__fix_double_booking_index.java` partial `idx_appointment_slot_active ON appointments(barber_name, booking_date, booking_time) WHERE status IN ('PENDING','APPROVED')` (PostgreSQL; H2 via `active_slot_marker INTEGER AS (CASE WHEN status IN ('PENDING','APPROVED') THEN 1 ELSE NULL END)` + `UNIQUE`). `BusySlotsService.getBusySlots()` `@Cacheable sync=true` 2 m reads `findDistinctBookingTimes(..., DENIED)` 43 µs `EXPLAIN`-verified; `AppointmentServiceImpl` catches `DataIntegrityViolationException 23505` as DB-enforced second guard (50-way race → exactly 1/49, 808/sec).
- **Redis Caching & Eviction (P0-2 §39)**: `CacheConfig.java` Redis `10m` (`barbers`/`publicBarbers`/`services`, `sync=true` stampede protection, `GenericJackson2JsonRedisSerializer` explicit allow-list, `disableCachingNullValues`) vs `simple` dev; `BarberServiceImpl`/`CatalogServiceImpl` `@Cacheable sync=true` + `@CacheEvict(allEntries=true)` on `create/update/delete`; verified: cached `0.6 µs` vs DB `42 µs` (50–90× H2, ~1200× PG).
- **Tiered Cache-Control & ETag (P1-3 §44)**: `CacheControl.maxAge(5, TimeUnit.MINUTES).cachePublic()` for `GET /api/v1/catalog`/`barbers`/`reviews/public/barber-ratings` (5 m public, aligns 10 m `@Cacheable` + `ShallowEtagHeaderFilter` GET-only → `304` after expiry), `maxAge(30s).cachePrivate().mustRevalidate()` for `GET /appointments/public/busy-slots` (30 s private), `noCache().cachePrivate().mustRevalidate()` for admin `GET /appointments` & `barbers/admin`; `frontend/nginx.conf` `keepalive 64` + split `js|css` `immutable, max-age=15552000` (6 M hashed bundles, 0 revalidation) vs `ico|gif|jpe?g|png|svg|woff2?` `public` + `index.html` `try_files`.
- **Micrometer Histograms (P1-5 §46)**: `application-prod.properties` `management.metrics.distribution.percentiles.http.server.requests=0.5,0.95,0.99` + `percentiles-histogram=true` + `sla=50ms,100ms,200ms` → `p50/p95/p99` & `_bucket{le}` histograms at `/actuator/prometheus` for `histogram_quantile` SLO (≈1–2% cardinality per `[uri,method,status]` series).
- **Mobile Query Tuning (P1-4 §45)**: `mobile/src/query/queryClient.ts` `staleTime 60_000` (was 0, cuts catalog/barbers refetch ~50% on tab nav) + `gcTime 5*60_000` (retain across nav) + exponential `retryDelay min(1000*2^attempt,30000)` `retry:1` `refetchOnWindowFocus:false`; `mobile/src/api/client.ts` `timeout 10000` (was 15000, fail-fast < JPA 5 s + Hikari 20 s).
- **Healthcheck Divergence (P1-6 §47)**: Local `Dockerfile` `HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s CMD wget -qO /dev/null http://localhost:8080/actuator/health/liveness` for `docker run` parity & `depends_on: service_healthy`; `Dockerfile.x64` intentionally omits `HEALTHCHECK` — K8s `livenessProbe`/`readinessProbe` in `homelab/TF/gitops/apps/taskflow/backend.yaml` owns prod.
- **UseContainerSupport & Diagnostics (P1-2 §43)**: Explicit `-XX:+UseContainerSupport` (self-documenting cgroup-aware), `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heapdump.hprof` (0% until OOM) + `-Xlog:gc*:file=/tmp/gc.log:time,uptime:filecount=3,filesize=10m` (~0.7% overhead) in `JAVA_TOOL_OPTIONS` (`docker-compose.yml` local 1.25 GiB heap, `homelab/TF/.../backend.yaml` prod 1 GiB); `/tmp` is `tmpfs`.
- **Lookbook Fix (P2 §49)**: `mobile/src/components/lookbook/LookbookGallery.tsx` replaces `FlatList scrollEnabled={false}` inside parent `ScrollView` (defeats virtualization) with plain `LOOKBOOK_DATA.map` + `View` + `Card`; parent `ScrollView` owns scroll, documented upgrade to `FlashList` when catalogue >50 items. CWV budgets in `k6/browser.js` tightened to `ttfb<800 fcp<1800 lcp<2500` (web.dev good) vs prior lenient `p95<2500 lcp<6000`.
- **PgBouncer Ceiling (P2 §50)**: `application-prod.properties:38` documents Hikari `maximum-pool-size=25` (`minimum-idle=10`) knee curve (`10→3015 RPS`, `25→4128 RPS +37% selected`, `50→4257 RPS +3%`) and `pool×replicas < PG max_connections (100)`; `>2 replicas → PgBouncer transaction pooling` sidecar `pool_mode=transaction max_client_conn=1000 default_pool_size=25` via `homelab/TF` so PG sees only `default_pool_size` connections.
- **Web Auth**: Stateless JWT in an HttpOnly `access_token` cookie (Asymmetric RSA-2048 signing via OAuth2 Resource Server). Role/identity is restored via `GET /api/v1/auth/me` into an in-memory Signal (`AuthState`) and never stored in `sessionStorage`/`localStorage`. CSRF protection uses the double-submit `XSRF-TOKEN` cookie.
- **Mobile Auth**: Native clients use `POST /api/v1/auth/mobile/login` and store the returned bearer token in `expo-secure-store`. The shared `/api/v1/auth/me` endpoint confirms the token on startup. Bearer-only requests do not require browser CSRF tokens; requests carrying the web `access_token` cookie remain protected.
- **Frontend uses Angular 22 Signals** (no Zone.js digest loops). Styles use Tailwind with custom `gold`/`obsidian` color palette from `frontend/src/theme/tokens.json`.
- **Mobile uses React Native & Expo** with TypeScript, React Navigation, TanStack Query, Zustand, and `expo-secure-store` for hardware token security. Theme colors import from `mobile/src/theme/tokens.json`.
- **Prettier** is the formatter (100 char width, single quotes). Run `npx prettier --write <file>` in `frontend/`.
- **Testcontainers** are used for PostgreSQL integration tests. They require Docker to be running.
- **ArchUnit** enforces package-level architecture constraints (`src/test/java/com/example/taskflow/architecture/`).
- **Default credentials**: `admin` / `admin-password` (overridden by `SPRING_SECURITY_PASSWORD` env var).
- **Nginx** frontend container runs on unprivileged port 8080 (mapped from host 4200).

## Gotchas

- `./gradlew test` requires Docker (Testcontainers).
- `./gradlew check` includes OWASP dependency check — build will fail if any dependency has CVSS >= 7.
- The `.env` file (from `.env.example`) is required by docker-compose and is git-ignored — copy `.env.example` to `.env` and adjust as needed. Change default passwords before production use.
- Frontend `dist/` and `node_modules/` are gitignored. Do not commit build artifacts.
- E2E tests (`npm run e2e`) start their own dev server — don't run `npm start` separately when running e2e.
- **PgBouncer ceiling**: `application-prod.properties:38` — Hikari `pool×replicas` must stay `< PG max_connections (100)`; `3 replicas →75 connections (25 spare)` borderline, `4→100` blocked. `>2 replicas → PgBouncer transaction pooling` (`homelab/TF` sidecar `pool_mode=transaction max_client_conn=1000 default_pool_size=25`) or lower pool to `10`.
- **Cache eviction is verified, not assumed**: `barbers`/`publicBarbers`/`services` (`10 m`) & `busySlots` (`2 m`) use `@CacheEvict(allEntries=true)` on `create/update/delete`; `ReferenceDataCacheBenchmarkTest` asserts `200→201` after mutation. Don't add L2/Hib query cache without re-testing.
- **Cache-Control ↔ @Cacheable alignment**: Changing tiered headers (`5 m public` catalog/barbers/ratings, `30 s private` busySlots, `no-cache private` admin) must keep `10 m` `@Cacheable` and `ShallowEtagHeaderFilter` (GET-only) in sync — otherwise `304`/`TTL` mismatches cause stale or over-fetch.
- **HEALTHCHECK divergence**: Don't add `HEALTHCHECK` to `Dockerfile.x64` — K8s `livenessProbe` owns prod; local `Dockerfile` keeps it for `docker run` & `depends_on: service_healthy` (`P1AndP2BenchmarkTest` asserts presence/absence).
- **Mobile query tuning**: `staleTime 0→60_000` cuts refetch ~50% — but raising further risks showing stale `DENIED` slots; `busySlots` stays `30 s private` for volatility. `timeout 10000` < JPA 5 s+Hikari 20 s — don't raise above server timeout.
- **UseContainerSupport is explicit**: `JAVA_TOOL_OPTIONS` carries `UseContainerSupport` + `HeapDumpOnOutOfMemoryError` + `gc.log` in both `docker-compose.yml` and `homelab/TF` — sizing lives in env, not image CMD (last-wins precedence bug).
