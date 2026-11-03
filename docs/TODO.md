# TaskFlow — Audit Findings

Open work is tracked in [GitHub issues](https://github.com/stefanf81/taskflow-enterprise/issues). This file keeps the findings that are
resolved, with the original problem statement for context, so the reasoning behind the
current code stays findable. Section numbers are the ones code comments and specs refer to
(for example "TODO 4.2").

| Former section | Issue | Open item |
| --- | --- | --- |
| 1.1 | [#215](https://github.com/stefanf81/taskflow-enterprise/issues/215) | Registering a customer's email exposes and cancels their bookings (P0) |
| 1.3 | [#216](https://github.com/stefanf81/taskflow-enterprise/issues/216) | Redis runs without authentication |
| 1.4 | [#217](https://github.com/stefanf81/taskflow-enterprise/issues/217) | The db container receives every secret in .env |
| 1.7 | [#218](https://github.com/stefanf81/taskflow-enterprise/issues/218) | Remaining gaps in JWT revocation |
| 1.9 | [#219](https://github.com/stefanf81/taskflow-enterprise/issues/219) | Verify the production trusted-proxy regex |
| 1.10 | [#220](https://github.com/stefanf81/taskflow-enterprise/issues/220) | The application connects to PostgreSQL as the superuser |
| 3.2 | [#221](https://github.com/stefanf81/taskflow-enterprise/issues/221) | Run the OWASP dependency check automatically |
| 3.3 | [#222](https://github.com/stefanf81/taskflow-enterprise/issues/222) | DAST scans only as admin and ignores error responses |
| 3.7 | [#223](https://github.com/stefanf81/taskflow-enterprise/issues/223) | `/actuator/prometheus` is unauthenticated |
| 3.8 | [#224](https://github.com/stefanf81/taskflow-enterprise/issues/224) | CSP still allows `style-src 'unsafe-inline'` |
| 5 | [#225](https://github.com/stefanf81/taskflow-enterprise/issues/225) | Blockers for running more than one backend replica |
| 5 | [#226](https://github.com/stefanf81/taskflow-enterprise/issues/226) | Mobile release prerequisites |
| 5 | [#227](https://github.com/stefanf81/taskflow-enterprise/issues/227) | Retired services cannot be viewed |
| 5 | [#228](https://github.com/stefanf81/taskflow-enterprise/issues/228) | Cache metrics are not bound for the wrapped Redis cache manager |
| 5 | [#229](https://github.com/stefanf81/taskflow-enterprise/issues/229) | V36 trigram indexes lock `appointments` while they build |

---

## 1. Security & Authorization (P0 — High Priority)

### 1.2 Production Admin Password Fallback (Resolved)
- **Resolved:** `AdminPasswordGuard` aborts a `prod` startup when the admin password is unset, `admin-password` or a `CHANGE_ME` placeholder, and `initAdminUser` now re-syncs the stored hash from `SPRING_SECURITY_PASSWORD` on every boot (so a wrong first boot no longer sticks). Disposable stacks opt out with `APP_REQUIRE_STRONG_ADMIN_PASSWORD=false`. The original finding follows for context.
- **Location:** `src/main/resources/application.properties:71`, `src/main/resources/application-prod.properties`
- **Problem:** `spring.security.user.password=${SPRING_SECURITY_PASSWORD:admin-password}` provides a weak default. Unlike persistent RSA keys (`app.rsa.require-persistent-keys=true`), `application-prod.properties` does not fail fast if `SPRING_SECURITY_PASSWORD` is omitted, allowing production instances to bootstrap with `admin` / `admin-password`.
- **Remediation:** Remove `:admin-password` fallback in `application-prod.properties` (`spring.security.user.password=${SPRING_SECURITY_PASSWORD}`) to abort context initialization if the environment variable is missing.

### 1.5 Rate Limiter Fail-Closed Policy on Authentication Routes (Resolved differently)
- **Resolved differently:** instead of failing closed (503), the limiter now falls back to a per-JVM in-memory counter with the same limits when Redis errors, and skips Redis for 5 s after a failure. Auth routes therefore stay throttled during an outage and a Redis outage no longer adds a timeout to every request. The compose Redis no longer evicts (`noeviction`), so `rate_limit:*` buckets cannot be dropped under memory pressure; a full Redis rejects the write and the fallback counter applies. The original finding follows for context.
- **Location:** `src/main/java/com/example/taskflow/core/RateLimiterConfig.java:111-113`
- **Problem:** `doFilterInternal` catches all Redis execution exceptions and logs a warning, failing open. Under Redis memory eviction (`volatile-lru`) or connection failure, rate limits (20 req/min) on `/api/v1/auth/` routes are bypassed.
- **Remediation:** Fail closed (HTTP 503 + `Retry-After: 60`) specifically when `isAuthEndpoint` is true, while retaining fail-open behavior for general API routes.

### 1.6 Shell Script Injection Vector in Image Publication Workflow (Resolved)
- **Resolved:** `pushdockerimage.yml` passes `inputs.image_tag` through an environment variable and validates it against `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$` before use. The original finding follows for context.
- **Location:** `.github/workflows/pushdockerimage.yml:85`
- **Problem:** `tag="${{ inputs.image_tag }}"` directly interpolates unvalidated workflow dispatch input into a bash script block.
- **Remediation:** Pass the input via an environment variable (`env: RAW_TAG: ${{ inputs.image_tag }}`) and add regex validation (`^[A-Za-z0-9._-]{1,128}$`).

### 1.8 Account-Aware Authentication Throttling (Resolved)
- **Resolved:** `LoginAttemptLimiter` counts failed logins per username + client IP (10 per 300 s by default, 429 + `Retry-After`, cleared by a successful login) on both `/auth/login` and `/auth/mobile/login`. With `app.state.store=redis` (prod) the counter is a Redis fixed window shared by all replicas (`login_failures:<sha256>`); during a Redis outage a per-JVM counter applies the same limit. The original finding follows for context.
- **Location:** `src/main/java/com/example/taskflow/core/RateLimiterConfig.java:89-99`, `src/main/java/com/example/taskflow/auth/SecurityConfig.java:226-233`
- **Problem:** The auth bucket keys solely on the client IP (`rate_limit:<ip>:auth`) and `CustomUserDetailsService` carries no per-account attempt state. A distributed attack (botnet / residential proxies / Tor) stays under the 20 req/min per-IP cap while guessing credentials without bound.
- **Remediation:** Track failed attempts per account in Redis (e.g. a counter updated from `AuthenticationFailureBadCredentialsEvent`) and apply exponential backoff or a temporary throttle to that account. Do not use permanent lockout — it hands attackers a denial-of-service weapon. Retain the per-IP bucket for volumetric bursts.

---

## 2. Data Layer & Application Robustness (P1 — High/Medium Priority)

### 2.1 NullPointerException on Empty Table in Stats Aggregate (Resolved)
- **Resolved:** every `SUM` in `getAppointmentStats` is wrapped in `COALESCE`. The original finding follows for context.
- **Location:** `src/main/java/com/example/taskflow/appointment/internal/AppointmentRepository.java:51-60`
- **Problem:** `getAppointmentStats` computes sums via `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` without `COALESCE`. On a fresh database with zero appointments, SQL returns `NULL` for these sums. Hibernate unboxes these into primitive `long` fields in the `AppointmentStats` record constructor, throwing `NullPointerException`.
- **Remediation:** Wrap all aggregate `SUM(...)` terms with `COALESCE(SUM(...), 0)`:
  ```sql
  SELECT new com.example.taskflow.appointment.AppointmentStats(
      COUNT(a),
      COALESCE(SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.PENDING THEN 1 ELSE 0 END), 0),
      ...
  ) FROM Appointment a LEFT JOIN a.service s
  ```

### 2.2 Case-Insensitive Email Functional Indexes (Resolved on PostgreSQL)
- **Resolved:** lookups use explicit `lower(col) = lower(:email)` and V28 adds `lower()` indexes on PostgreSQL only (H2 has no expression indexes). The original finding follows for context.
- **Location:** `src/main/java/com/example/taskflow/appointment/internal/AppointmentRepository.java:25`, `src/main/java/com/example/taskflow/auth/internal/UserRepository.java:11`
- **Problem:** `findByCustomerEmailIgnoreCase` and `findByEmailIgnoreCase` generate `WHERE lower(email) = lower(?)` (or `upper`). Standard B-tree indexes on `appointments.customer_email` and `app_users.email` are ignored by PostgreSQL, causing sequential table scans.
- **Remediation:** Add Flyway migration:
  ```sql
  CREATE INDEX idx_appointments_customer_email_lower ON appointments (lower(customer_email));
  CREATE INDEX idx_app_users_email_lower ON app_users (lower(email));
  ```

### 2.3 Unique Constraint and Index on `services.name` (Resolved)
- **Resolved:** V32 dedupes and adds a case-insensitive unique index; create/update answer 409; deleting a service with bookings retires it. The original finding follows for context.
- **Location:** `src/main/resources/db/migration/V5__create_service_catalog.sql`, `src/main/java/com/example/taskflow/catalog/internal/ServiceItemRepository.java:14`
- **Problem:** Booking creation resolves service catalog entries by name via `findByName`. The `services.name` column lacks an index and a `UNIQUE` constraint, allowing accidental duplicate names that trigger `IncorrectResultSizeDataAccessException` (HTTP 500).
- **Remediation:** Add Flyway migration:
  ```sql
  CREATE UNIQUE INDEX idx_services_name ON services (name);
  ```

### 2.4 Unbounded Growth of Notification Outbox Table (Resolved)
- **Resolved:** daily purge of `SENT` rows older than `app.notification.retention-days` (30). The original finding follows for context.
- **Location:** `src/main/java/com/example/taskflow/notification/NotificationOutbox.java`, `src/main/java/com/example/taskflow/notification/NotificationRelayScheduler.java`
- **Problem:** Records in `notification_outbox` accumulate indefinitely with no retention, cleanup, or partitioning strategy.
- **Remediation:** Add a scheduled daily cleanup task (`@Scheduled(cron = "0 15 3 * * *")`) purging `SENT` notifications older than 30 days:
  ```java
  notificationOutboxRepository.deleteByStatusAndSentAtBefore("SENT", LocalDateTime.now().minusDays(30));
  ```

### 2.5 N+1 Query Loop in `findFirstAvailableBarber` (Resolved)
- **Resolved:** `BusySlotsService.loadBarberDays` preloads time off, weekday schedules and active bookings with set-based queries and the pure `evaluate` function applies the booking rules in memory, so No-Preference resolution issues 4 statements whatever the number of barbers (`NoPreferenceQueryCountIntegrationTest`). The original finding follows for context.
- **Location:** `src/main/java/com/example/taskflow/appointment/BusySlotsService.java:137-160`
- **Problem:** `findFirstAvailableBarber` runs inside the uncached booking transaction path. For each barber, it executes 3 separate queries (`findTimeOffForBarberOnDate`, `findByBarberIdAndDayOfWeek`, `findDistinctBookingTimes`), causing `1 + 3N` queries per booking attempt.
- **Remediation:** Replace the per-barber loop with 3 set-based queries intersecting working barbers, time-off records, and booked slots for that time window in memory.

---

## 3. CI/CD, Supply Chain & Configuration Hygiene (P2 — Medium Priority)

### 3.1 Immutable Commit SHA Pinning for GitHub Actions (Resolved)
- **Resolved:** every third-party action is pinned to a full commit SHA with a version comment, and `.github/renovate.json` pins new ones (`pinDigests`). GitHub-owned `actions/*` and `github/*` stay on tags. The original finding follows for context.
- **Location:** `.github/workflows/*.yml`
- **Problem:** Workflows reference third-party actions by mutable release tags (`@v7`, `@v3.5.0`, etc.). If an upstream account or tag is hijacked, malicious code could execute in CI.
- **Remediation:** Configure Renovate (`helpers:pinGitHubActionDigests`) to pin all actions to full 40-character commit SHAs with trailing version comments (e.g. `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`).

### 3.4 Container Hardening Documentation Drift in `AGENTS.md` (Resolved)
- **Resolved:** Aligned `AGENTS.md`, `README.md`, and `SYSTEM-HARDENING.md` to accurately document that `cap_drop: [ALL]` and `read_only: true` apply specifically to application edge containers (`backend` and `frontend`), while data stores (`db`, `redis`, `jaeger`) run with standard defaults. `docs/adr/ADR-012-lua-rate-limiter.md` and the comment in `RateLimiterConfig.java` were updated to reflect `server.forward-headers-strategy=native` and Tomcat's `RemoteIpValve`.
- **Location:** `AGENTS.md`, `README.md`, `docs/adr/ADR-012-lua-rate-limiter.md`, `RateLimiterConfig.java`

### 3.5 Inactive Lettuce Connection Pool Configuration (Resolved)
- **Resolved (2026-10-17, BENCHMARKS.md §58):** the inactive `spring.data.redis.lettuce.pool.*` properties were removed and `application-prod.properties` documents the shared-connection model (Lettuce multiplexes one thread-safe connection; every command is sub-millisecond, so a pool would add nothing). The original finding follows for context.
- **Location:** `src/main/resources/application-prod.properties:151-154`
- **Problem:** `spring.data.redis.lettuce.pool.*` properties are defined with comments about preventing connection thrashing, but `commons-pool2` is not on the classpath. Spring Boot silently ignores the pool configuration and falls back to a single shared connection.
- **Remediation:** Add `implementation 'org.apache.commons:commons-pool2'` to `build.gradle` if pooling is desired, or remove the inactive configuration properties and document the shared-connection model.

### 3.6 Dead Hibernate Second-Level Cache Annotations (Resolved)
- **Resolved:** L2 and query caches are explicitly disabled (tested) and the `@Cache` regions are renamed `l2-*` so they cannot collide with Spring cache names. The original finding follows for context.
- **Location:** `src/main/java/com/example/taskflow/appointment/Barber.java:9`, `catalog/ServiceItem.java:10`, `review/Review.java:11`
- **Problem:** Entities carry `@Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "...")` annotations, but second-level caching is disabled in Spring Boot properties. The region names match Spring Cache names (`barbers`, `services`), creating a namespace collision risk if 2LC is ever enabled.
- **Remediation:** Remove the dead `@Cache` annotations or isolate the region names (e.g. `l2-barbers`).

### 3.9 H2 Console `permitAll()` (Resolved)
- **Resolved:** the rule is gone. Spring Boot 4 serves the H2 console only with its own dependency, which the project does not include, so there is no console and no `permitAll()` for it (`SecurityConfig`). The original finding follows for context.
- **Location:** `src/main/java/com/example/taskflow/auth/SecurityConfig.java:120`, `src/main/resources/application.properties:45-47`
- **Problem:** The H2 console path is unauthenticated. Production disables the console entirely (`application-prod.properties:49`) and dev binds it to localhost with `web-allow-others=false`, so there is no current production impact.
- **Remediation:** Keep the console disabled in production; if it is ever enabled outside dev, gate it behind ADMIN authentication or remove the `permitAll()` rule.

---

## 4. Client UX, Accessibility & Resilience (P3 — Medium/Low Priority)

### 4.1 WCAG AA Color Contrast Token Alignment (Resolved)
- **Resolved:** step 3's empty state uses dark tokens (`bg-zinc-900/40 text-zinc-300`, 3.87→12.96:1); the portal booking code is `text-zinc-400` (2.53→7.45:1); mobile `text.muted` is `#8a8a93` (3.67–4.35→5.18–6.14:1), including the HomeScreen footer literal. Also fixed: selected date-chip labels on gold (1.04–2.46→8.55:1), stylist initials (2.46→5.09–8.55:1), destructive hover fills (3.75–3.81→4.53–4.77:1) and the mobile completed-step check (1.68→7.91:1). Regression gates: the contrast rules in `theme:check` (web, part of `npm run lint`) and `mobile/__tests__/theme.test.ts`. The original finding follows for context.
- **Location:** `frontend/src/app/features/booking/booking-wizard.html:409-422`, `frontend/src/app/features/customer/customer-portal.html:93`, `mobile/src/theme/tokens.json:26`
- **Problem:**
  - **Web Wizard Step 3:** Light `#fafbfd` panel with `#7e7e8a` text achieves ~3.8:1 contrast (below 4.5:1 AA).
  - **Web Customer Portal:** Booking code uses `text-zinc-600` on dark card background (~2.3:1).
  - **Mobile Theme:** `text.muted` is `#71717a` (~4.3:1) vs Web's accessibility override `#8a8a93` (5.1:1).
- **Remediation:** Replace light wizard panel with dark surface tokens (`bg-zinc-900/40 text-zinc-300`), update booking code to `text-zinc-400`, and align mobile `text.muted` to `#8a8a93`.

### 4.2 Wizard Stepper Keyboard Navigation & WAI-ARIA Tabs Pattern (Resolved)
- **Resolved:** the stepper implements the APG tabs pattern with manual activation: ArrowLeft/ArrowRight (wrapping), Home and End move focus; Enter/Space activate; steps that are not reachable yet stay focusable with `aria-disabled="true"` and are refused by `setStep` (`isStepReachable`: every previous step valid); `aria-controls` only on the selected tab; per-tab `aria-label`; visible focus outline. Covered by `booking-wizard.spec.ts`. The original finding follows for context.
- **Location:** `frontend/src/app/features/booking/booking-wizard.html:22-41`
- **Problem:** Stepper tabs use `role="tab"` with roving `tabindex="-1"` on inactive steps, but lack `keydown` listeners (`ArrowLeft`/`ArrowRight`/`Home`/`End`). Inactive steps are unreachable by keyboard Tab navigation alone.
- **Remediation:** Implement standard WAI-ARIA tablist keyboard navigation on the stepper container.

### 4.3 Premature `role="alert"` Announcements on Wizard Step 4 (Resolved)
- **Resolved:** step 4 errors and `aria-invalid`/`aria-describedby` appear only once a field is `touched()`; a submit marks the fields touched, shows every error and focuses the first invalid field; the touched state resets after a successful booking. Covered by `booking-wizard.spec.ts`. The original finding follows for context.
- **Location:** `frontend/src/app/features/booking/booking-wizard.html:448-500`
- **Problem:** Required field error elements with `role="alert"` render immediately when Step 4 mounts because validation does not check whether fields have been touched, firing false validation alerts to screen readers.
- **Remediation:** Gate error alerts behind `touched()` signal checks (matching `auth-modal.ts:114`).

### 4.4 Stale `initialPublicId` in Mobile Public Actions Screen (Resolved)
- **Resolved:** the modals re-sync the id when `visible`/`initialPublicId` change. The original finding follows for context.
- **Location:** `mobile/src/features/landing/PublicActionsScreen.tsx:16`, `mobile/src/features/landing/PublicCancelModal.tsx:23`
- **Problem:** `useState(initialPublicId)` in `PublicCancelModal` and `PublicReviewModal` initializes once upon mounting. Re-navigating to the screen with a different booking code retains the initial pre-filled value.
- **Remediation:** Add `useEffect(() => { if (visible) setPublicId(initialPublicId); }, [visible, initialPublicId]);`.

### 4.5 Mobile Notification Polling in Background/Inactive Tabs (Resolved)
- **Resolved:** polling is gated by `useIsFocused()` and TanStack `focusManager` follows `AppState`. The original finding follows for context.
- **Location:** `mobile/src/features/admin/useNotifications.ts:8`
- **Problem:** `refetchInterval: 15000` polls the outbox endpoint every 15 seconds continuously as long as the tab remains mounted in the bottom tab navigator.
- **Remediation:** Gate polling using `useIsFocused()` from `@react-navigation/native` (`refetchInterval: isFocused ? 15000 : false`).

---

## 5. Resolved Follow-Ups and Accepted Trade-Offs

- **End-time constraint (resolved):** `appointments.booking_end_time` (V35) plus the PostgreSQL `appointments_no_overlap` exclusion constraint close the race between overlapping bookings with different start times; V35 denies pre-existing overlaps (APPROVED first, then lowest id). H2 has no exclusion constraints, so dev/test rely on the in-transaction check. Production needs the `btree_gist` extension (see `db/migration/README.md`).
- **Redis outage throughput:** the caches fail open (ADR-018), but cached endpoints stay at ~38% of normal throughput while Redis is down because `SingleFlightCacheManager` serialises loads per key per JVM (deliberately, to avoid a database stampede).
