# TaskFlow — Engineering Backlog & Unresolved Issues

This document tracks unresolved security findings, architectural technical debt, performance optimizations, and accessibility/UX gaps identified during project audits.

---

## 1. Security & Authorization (P0 — High Priority)

### 1.1 Customer Booking Ownership & Self-Registration IDOR
- **Location:** `src/main/java/com/example/taskflow/auth/AuthController.java:100-115`, `appointment/CustomerController.java:34-43`, `appointment/AppointmentServiceImpl.java:121-137`
- **Problem:** `POST /api/v1/auth/register` does not verify mailbox ownership. Anyone can register `victim@example.com`, authenticate, and call `GET /api/v1/customer/appointments` to view the victim's full guest booking history (name, phone, dates, services) or `DELETE /api/v1/customer/appointments/{publicId}` to cancel them.
- **Current State:** Documented by `CustomerOwnershipIntegrationTest.java`, but application logic still binds ownership solely to the self-asserted email string.
- **Secondary Oracle:** Guest cancellation (`AppointmentServiceImpl.java:460-467`) returns distinct errors — 404 "Appointment booking not found." for an unknown UUID vs 400 "Verification failed..." for an email mismatch — confirming whether a `publicId` exists. The authenticated path (`cancelMyAppointment`, `AppointmentServiceImpl.java:141-148`) already unifies both cases into a single 404.
- **Remediation:** 
  1. Introduce a high-entropy, cryptographically secure `manageToken` returned on booking creation (`201 Created`), storing only its hash in the database.
  2. Require this token for all guest-initiated cancellations and reviews (`PUT /api/v1/appointments/public/cancel/{publicId}`, `POST /api/v1/reviews/public/{publicId}`).
  3. Require email verification before newly registered accounts can view or claim prior bookings.
  4. Unify guest-cancel error responses to a single generic message so the endpoint no longer reveals whether a booking UUID exists.

### 1.2 Production Admin Password Fallback
- **Location:** `src/main/resources/application.properties:71`, `src/main/resources/application-prod.properties`
- **Problem:** `spring.security.user.password=${SPRING_SECURITY_PASSWORD:admin-password}` provides a weak default. Unlike persistent RSA keys (`app.rsa.require-persistent-keys=true`), `application-prod.properties` does not fail fast if `SPRING_SECURITY_PASSWORD` is omitted, allowing production instances to bootstrap with `admin` / `admin-password`.
- **Remediation:** Remove `:admin-password` fallback in `application-prod.properties` (`spring.security.user.password=${SPRING_SECURITY_PASSWORD}`) to abort context initialization if the environment variable is missing.

### 1.3 Datastore Host Interface Exposure & Redis Authentication
- **Location:** `docker-compose.yml:42, 159`, `src/main/resources/application-prod.properties:146-149`
- **Problem:** PostgreSQL (`5432:5432`) and Redis (`6379:6379`) bind to `0.0.0.0` on the host. Redis runs without `--requirepass`, allowing unauthorized network clients to flush rate limits, inspect cached barber contact details, or poison cache entries.
- **Evidence:** The official `redis` Docker image disables Redis protected mode at build time (docker-library patches `protected-mode` to `0`), so a published port with no `requirepass` has no compensating control.
- **Remediation:** 
  1. Remove host `ports:` mapping (or restrict strictly to `127.0.0.1` for local debug workflows).
  2. Configure `--requirepass ${REDIS_PASSWORD}` in `docker-compose.yml` and set `spring.data.redis.password=${REDIS_PASSWORD}` in `application-prod.properties`.

### 1.4 Database Container Environment Variable Isolation
- **Location:** `docker-compose.yml:39-40`
- **Problem:** The `db` service imports the entire `.env` file via `env_file: .env`, unnecessarily injecting `APP_RSA_PRIVATE_KEY` and `SPRING_SECURITY_PASSWORD` into the PostgreSQL container.
- **Remediation:** Replace `env_file` with explicit environment entries: `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.

### 1.5 Rate Limiter Fail-Closed Policy on Authentication Routes
- **Location:** `src/main/java/com/example/taskflow/core/RateLimiterConfig.java:111-113`
- **Problem:** `doFilterInternal` catches all Redis execution exceptions and logs a warning, failing open. Under Redis memory eviction (`volatile-lru`) or connection failure, rate limits (20 req/min) on `/api/v1/auth/` routes are bypassed.
- **Remediation:** Fail closed (HTTP 503 + `Retry-After: 60`) specifically when `isAuthEndpoint` is true, while retaining fail-open behavior for general API routes.

### 1.6 Shell Script Injection Vector in Image Publication Workflow
- **Location:** `.github/workflows/pushdockerimage.yml:85`
- **Problem:** `tag="${{ inputs.image_tag }}"` directly interpolates unvalidated workflow dispatch input into a bash script block.
- **Remediation:** Pass the input via an environment variable (`env: RAW_TAG: ${{ inputs.image_tag }}`) and add regex validation (`^[A-Za-z0-9._-]{1,128}$`).

### 1.7 Stateless JWT Revocation & Denylist on Logout
- **Location:** `src/main/java/com/example/taskflow/auth/AuthController.java:157-170`, `src/main/java/com/example/taskflow/auth/TokenProvider.java:41-48`
- **Problem:** `POST /api/v1/auth/logout` only clears the client-side cookie; native mobile clients have no logout endpoint. Issued tokens remain valid until the 1-hour expiration.
- **Remediation:** Add a unique `jti` claim to issued JWTs. On logout, store the `jti` in Redis with a TTL matching remaining token lifetime, and validate incoming tokens against this denylist in `SecurityConfig`.

### 1.8 Account-Aware Authentication Throttling
- **Location:** `src/main/java/com/example/taskflow/core/RateLimiterConfig.java:89-99`, `src/main/java/com/example/taskflow/auth/SecurityConfig.java:226-233`
- **Problem:** The auth bucket keys solely on the client IP (`rate_limit:<ip>:auth`) and `CustomUserDetailsService` carries no per-account attempt state. A distributed attack (botnet / residential proxies / Tor) stays under the 20 req/min per-IP cap while guessing credentials without bound.
- **Remediation:** Track failed attempts per account in Redis (e.g. a counter updated from `AuthenticationFailureBadCredentialsEvent`) and apply exponential backoff or a temporary throttle to that account. Do not use permanent lockout — it hands attackers a denial-of-service weapon. Retain the per-IP bucket for volumetric bursts.

### 1.9 Trusted-Proxy Regex Mis-Escaped in Compose
- **Location:** `docker-compose.yml:86`, `src/main/resources/application-prod.properties:113`
- **Problem:** The Compose value contains doubled backslashes. YAML applies no escape processing, so the JVM receives a regex whose `\\.` sequences require a literal backslash and matches no IP. Verified with `docker compose config`: the parsed value matches neither `172.18.0.2` nor `127.0.0.1`. Tomcat's `RemoteIpValve` therefore never trusts Nginx's `X-Forwarded-For`, `getRemoteAddr()` returns the Nginx container IP, and every client shares one rate-limit bucket (also corrupting access logs). The inbound-XFF stripping in `frontend/nginx.conf` remains correct; only the trust decision fails.
- **Remediation:** Use single backslashes in the YAML value (`^172\.([1][6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$`), keep the scope limited to the actual proxy network, and add a startup or integration assertion that the compiled regex matches the Nginx container address. Apply the same escaping wherever the value is copied — the production value lives in the separate GitOps repository.

---

## 2. Data Layer & Application Robustness (P1 — High/Medium Priority)

### 2.1 NullPointerException on Empty Table in Stats Aggregate
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

### 2.2 Case-Insensitive Email Functional Indexes
- **Location:** `src/main/java/com/example/taskflow/appointment/internal/AppointmentRepository.java:25`, `src/main/java/com/example/taskflow/auth/internal/UserRepository.java:11`
- **Problem:** `findByCustomerEmailIgnoreCase` and `findByEmailIgnoreCase` generate `WHERE lower(email) = lower(?)` (or `upper`). Standard B-tree indexes on `appointments.customer_email` and `app_users.email` are ignored by PostgreSQL, causing sequential table scans.
- **Remediation:** Add Flyway migration:
  ```sql
  CREATE INDEX idx_appointments_customer_email_lower ON appointments (lower(customer_email));
  CREATE INDEX idx_app_users_email_lower ON app_users (lower(email));
  ```

### 2.3 Unique Constraint and Index on `services.name`
- **Location:** `src/main/resources/db/migration/V5__create_service_catalog.sql`, `src/main/java/com/example/taskflow/catalog/internal/ServiceItemRepository.java:14`
- **Problem:** Booking creation resolves service catalog entries by name via `findByName`. The `services.name` column lacks an index and a `UNIQUE` constraint, allowing accidental duplicate names that trigger `IncorrectResultSizeDataAccessException` (HTTP 500).
- **Remediation:** Add Flyway migration:
  ```sql
  CREATE UNIQUE INDEX idx_services_name ON services (name);
  ```

### 2.4 Unbounded Growth of Notification Outbox Table
- **Location:** `src/main/java/com/example/taskflow/notification/NotificationOutbox.java`, `src/main/java/com/example/taskflow/notification/NotificationRelayScheduler.java`
- **Problem:** Records in `notification_outbox` accumulate indefinitely with no retention, cleanup, or partitioning strategy.
- **Remediation:** Add a scheduled daily cleanup task (`@Scheduled(cron = "0 15 3 * * *")`) purging `SENT` notifications older than 30 days:
  ```java
  notificationOutboxRepository.deleteByStatusAndSentAtBefore("SENT", LocalDateTime.now().minusDays(30));
  ```

### 2.5 N+1 Query Loop in `findFirstAvailableBarber`
- **Location:** `src/main/java/com/example/taskflow/appointment/BusySlotsService.java:137-160`
- **Problem:** `findFirstAvailableBarber` runs inside the uncached booking transaction path. For each barber, it executes 3 separate queries (`findTimeOffForBarberOnDate`, `findByBarberIdAndDayOfWeek`, `findDistinctBookingTimes`), causing `1 + 3N` queries per booking attempt.
- **Remediation:** Replace the per-barber loop with 3 set-based queries intersecting working barbers, time-off records, and booked slots for that time window in memory.

---

## 3. CI/CD, Supply Chain & Configuration Hygiene (P2 — Medium Priority)

### 3.1 Immutable Commit SHA Pinning for GitHub Actions
- **Location:** `.github/workflows/*.yml`
- **Problem:** Workflows reference third-party actions by mutable release tags (`@v7`, `@v3.5.0`, etc.). If an upstream account or tag is hijacked, malicious code could execute in CI.
- **Remediation:** Configure Renovate (`helpers:pinGitHubActionDigests`) to pin all actions to full 40-character commit SHAs with trailing version comments (e.g. `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`).

### 3.2 Automated OWASP Dependency Check in CI
- **Location:** `.github/workflows/ci.yml`, `build.gradle:307-310`
- **Problem:** `build.gradle` configures `dependencyCheck { failBuildOnCVSS = 7.0f }`, but CI only runs `assemble test testcontainersTest jacocoTestReport spotbugsMain`. The CVSS >= 7.0 gate is never verified on pull requests.
- **Remediation:** Add a step in `ci.yml` invoking `./gradlew dependencyCheckAnalyze` with NVD API caching.

### 3.3 Multi-Identity DAST Scanning & ZAP Rule 100000 Scoping
- **Location:** `.github/workflows/dast.yml`, `.zap/api-rules.tsv:6`
- **Problem:** 
  1. The DAST API scan runs exclusively with an `admin` token, missing role boundary checks and unauthenticated fuzzing.
  2. Rule `100000` ("Error response code returned") is globally ignored, masking unintended 500 server crashes during fuzzing.
- **Remediation:** Add dedicated unauthenticated and `ROLE_CUSTOMER` scan jobs to `dast.yml`. Refine rule `100000` to ignore only expected 4xx client errors while alerting on 5xx server errors.

### 3.4 Container Hardening Documentation Drift in `AGENTS.md`
- **Location:** `AGENTS.md` vs `docker-compose.yml`
- **Problem:** `AGENTS.md` states that "All services completely drop kernel privileges (`cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`)" and mount read-only filesystems. In reality, only `backend` and `frontend` implement these settings; `db`, `redis`, and `jaeger` run with standard defaults.
- **Related Drift:** `docs/adr/ADR-012-lua-rate-limiter.md` states `server.forward-headers-strategy=framework`, but `application-prod.properties:110` uses `native`; the `RateLimiterConfig` comment referencing Spring's `ForwardedHeaderFilter` is likewise stale on the `native`/`RemoteIpValve` path. Align the ADR and comment with the deployed strategy.
- **Remediation:** Either harden `db`/`redis`/`jaeger` with non-root execution and capability dropping, or update `AGENTS.md` to accurately reflect that only edge containers are hardened.

### 3.5 Inactive Lettuce Connection Pool Configuration
- **Location:** `src/main/resources/application-prod.properties:151-154`
- **Problem:** `spring.data.redis.lettuce.pool.*` properties are defined with comments about preventing connection thrashing, but `commons-pool2` is not on the classpath. Spring Boot silently ignores the pool configuration and falls back to a single shared connection.
- **Remediation:** Add `implementation 'org.apache.commons:commons-pool2'` to `build.gradle` if pooling is desired, or remove the inactive configuration properties and document the shared-connection model.

### 3.6 Dead Hibernate Second-Level Cache Annotations
- **Location:** `src/main/java/com/example/taskflow/appointment/Barber.java:9`, `catalog/ServiceItem.java:10`, `review/Review.java:11`
- **Problem:** Entities carry `@Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "...")` annotations, but second-level caching is disabled in Spring Boot properties. The region names match Spring Cache names (`barbers`, `services`), creating a namespace collision risk if 2LC is ever enabled.
- **Remediation:** Remove the dead `@Cache` annotations or isolate the region names (e.g. `l2-barbers`).

### 3.7 Unauthenticated `/actuator/prometheus`
- **Location:** `src/main/java/com/example/taskflow/auth/SecurityConfig.java:127-128`, `src/main/resources/application-prod.properties:123`
- **Problem:** `GET /actuator/prometheus` is `permitAll()` and exposes per-route labels (URI/method/status) plus application metrics. Only `/actuator/health/liveness`, `/actuator/health/readiness`, and this endpoint are unauthenticated; `/actuator/info` and the root health group remain ADMIN-gated.
- **Remediation:** Confirm the production NetworkPolicy restricts the actuator port to the monitoring namespace (the intended control) or require authentication / a separate management port. Document the dependency so a future Service or port mapping cannot expose it silently.

### 3.8 CSP `style-src 'unsafe-inline'`
- **Location:** `frontend/Dockerfile:38-51` (build-generated `csp-importmap.conf`)
- **Problem:** The enforced CSP permits inline styles. This is not equivalent to allowing inline script and no CSS-injection path has been demonstrated, but it prevents full style integrity and is a stepping stone if a script vector ever appears.
- **Remediation:** Audit Angular's inline-style usage (e.g. `[style.*]` bindings, `ngStyle`) and migrate to `style-src-attr` hashes or nonces; keep `style-src` hashed where possible.

### 3.9 H2 Console `permitAll()`
- **Location:** `src/main/java/com/example/taskflow/auth/SecurityConfig.java:120`, `src/main/resources/application.properties:45-47`
- **Problem:** The H2 console path is unauthenticated. Production disables the console entirely (`application-prod.properties:49`) and dev binds it to localhost with `web-allow-others=false`, so there is no current production impact.
- **Remediation:** Keep the console disabled in production; if it is ever enabled outside dev, gate it behind ADMIN authentication or remove the `permitAll()` rule.

---

## 4. Client UX, Accessibility & Resilience (P3 — Medium/Low Priority)

### 4.1 WCAG AA Color Contrast Token Alignment
- **Location:** `frontend/src/app/features/booking/booking-wizard.html:409-422`, `frontend/src/app/features/customer/customer-portal.html:93`, `mobile/src/theme/tokens.json:26`
- **Problem:**
  - **Web Wizard Step 3:** Light `#fafbfd` panel with `#7e7e8a` text achieves ~3.8:1 contrast (below 4.5:1 AA).
  - **Web Customer Portal:** Booking code uses `text-zinc-600` on dark card background (~2.3:1).
  - **Mobile Theme:** `text.muted` is `#71717a` (~4.3:1) vs Web's accessibility override `#8a8a93` (5.1:1).
- **Remediation:** Replace light wizard panel with dark surface tokens (`bg-zinc-900/40 text-zinc-300`), update booking code to `text-zinc-400`, and align mobile `text.muted` to `#8a8a93`.

### 4.2 Wizard Stepper Keyboard Navigation & WAI-ARIA Tabs Pattern
- **Location:** `frontend/src/app/features/booking/booking-wizard.html:22-41`
- **Problem:** Stepper tabs use `role="tab"` with roving `tabindex="-1"` on inactive steps, but lack `keydown` listeners (`ArrowLeft`/`ArrowRight`/`Home`/`End`). Inactive steps are unreachable by keyboard Tab navigation alone.
- **Remediation:** Implement standard WAI-ARIA tablist keyboard navigation on the stepper container.

### 4.3 Premature `role="alert"` Announcements on Wizard Step 4
- **Location:** `frontend/src/app/features/booking/booking-wizard.html:448-500`
- **Problem:** Required field error elements with `role="alert"` render immediately when Step 4 mounts because validation does not check whether fields have been touched, firing false validation alerts to screen readers.
- **Remediation:** Gate error alerts behind `touched()` signal checks (matching `auth-modal.ts:114`).

### 4.4 Stale `initialPublicId` in Mobile Public Actions Screen
- **Location:** `mobile/src/screens/PublicActionsScreen.tsx:16`, `mobile/src/components/booking/PublicCancelModal.tsx:23`
- **Problem:** `useState(initialPublicId)` in `PublicCancelModal` and `PublicReviewModal` initializes once upon mounting. Re-navigating to the screen with a different booking code retains the initial pre-filled value.
- **Remediation:** Add `useEffect(() => { if (visible) setPublicId(initialPublicId); }, [visible, initialPublicId]);`.

### 4.5 Mobile Notification Polling in Background/Inactive Tabs
- **Location:** `mobile/src/hooks/useNotifications.ts:8`
- **Problem:** `refetchInterval: 15000` polls the outbox endpoint every 15 seconds continuously as long as the tab remains mounted in the bottom tab navigator.
- **Remediation:** Gate polling using `useIsFocused()` from `@react-navigation/native` (`refetchInterval: isFocused ? 15000 : false`).
