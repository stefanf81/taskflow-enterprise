# TaskFlow — Full Project Audit Report

> **Historical document:** This report reflects the repository state on 2026-07-25. Some findings and file references may no longer apply to the current codebase.

> **Current-status addendum (2026-08-07; refreshed 2026-09-02):** H12 is resolved. `scripts/sync-api-types.js` now deterministically writes both platform API type files from the reviewed `api/openapi.json` baseline; `scripts/check-openapi-contract.js` and CI reject unreviewed API changes or stale generated types. H9, H13, and L10 are also resolved — see findings below for details. The stale PostgreSQL version references in `BENCHMARKS.md` (claiming "PostgreSQL 17" while the current runtime image is `postgres:18.6-alpine`) have been fixed — current documentation consistently references PostgreSQL 18. JaCoCo coverage rule corrected to "branch only" (not "branch/line"). README updated to note that `/actuator/prometheus` requires ADMIN auth.

**Date:** 2026-07-25
**Scope:** Backend (Spring Boot), Frontend (Angular 22), Mobile (React Native/Expo), Shared, CI/CD, Scripts, Docs

---

## CRITICAL (3 issues)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| **C1** | **Self-invocation bypasses `@Transactional`.** `processReminders()` calls `this.processOne()` directly. Spring's AOP proxy never intercepts, so the `@Transactional` on `processOne()` is never applied. The `PESSIMISTIC_WRITE` lock acquired by `findByIdForUpdate()` operates without a transaction boundary, releasing the lock immediately. Two concurrent scheduler runs can both read `reminderSent == false` before either commits, causing **duplicate reminder notifications**. | `AppointmentReminderScheduler.java:34-86` | Data corruption — duplicate notifications sent to customers |
| **C2** | **`@Async @EventListener` fires BEFORE the calling transaction commits.** The `NotificationOutboxWriter` listens to `AppointmentStatusChangedEvent` with `@EventListener` (not `@TransactionalEventListener(AFTER_COMMIT)`). If the `AppointmentServiceImpl.updateAppointmentStatus()` transaction rolls back after the event publishes, the outbox row persists — an **orphaned notification** for a status change that never happened. | `NotificationOutboxWriter.java:33-49` | Data inconsistency — phantom notifications |
| **C3** | **Ephemeral RSA keys invalidate all JWTs on every restart.** When `APP_RSA_PRIVATE_KEY` / `APP_RSA_PUBLIC_KEY` env vars are empty (the default), the code generates a new RSA key pair at startup. All previously issued JWTs become invalid. Every container restart force-logs-out every user. Logged at `ERROR` level but functionally silent. | `SecurityConfig.java:259-289` | Operational — all sessions lost on restart |

---

## HIGH (17 issues)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| **H1** | **Lost async notifications.** If `NotificationOutboxWriter.handleAppointmentStatusChanged()` fails (DB timeout, constraint violation), the catch block logs the error but does **not** rethrow or re-enqueue. The notification is permanently lost with no retry mechanism. | `NotificationOutboxWriter.java:46-49` | Lost notifications |
| **H2** | **TOCTOU race in slot booking.** `createAppointment()` checks busy-slots (line 172) then saves (line 195) — non-atomic. Two concurrent requests with different idempotency keys can both pass the check. V21's partial unique index `idx_appointment_slot_active` on `(barber_name, booking_date, booking_time) WHERE status IN ('PENDING','APPROVED')` catches one, but the `DataIntegrityViolationException` handler only resolves idempotency-key collisions — slot-level violations are rethrown as 500 errors. | `AppointmentServiceImpl.java:168-213` | Double-booking or 500 errors |
| **H3** | **Duplicate `isLoggedIn` signal.** `AuthState.isLoggedIn` and `AppointmentStore.isLoggedIn` are separate signals that must be manually kept in sync across every login/logout path. Any code path that updates only one leaves the app with stale auth state — potentially showing admin UI to a logged-out user or vice versa. | `auth.state.ts:21`, `appointment.store.ts:18` | Auth state desync |
| **H4** | **`bootstrapDone` permanently blocks re-bootstrap.** `AuthState.bootstrap()` sets `bootstrapDone = true` on both success (line 31) and error (line 35), and never resets it. If the initial bootstrap call fails (401, network error), the auth guard skips all retry attempts and permanently redirects to the landing page. User must do a full page refresh to recover. | `auth.state.ts:22,31,35,58` | UX — permanent lockout until refresh |
| **H5** | **Weak password policy.** Registration only validates `@Size(min = 8)` with no complexity requirements (uppercase, lowercase, digit, special character). Passwords like `aaaaaaaa` or `12345678` are accepted. Default admin password `admin-password` is also weak. | `RegisterRequest.java:16-18` | Security — weak credentials |
| **H6** | **`BarberController` bypasses service layer entirely.** Directly injects `BarberRepository`, `BarberScheduleRepository`, `BarberTimeOffRepository`. No business validation, no transactional boundaries, no caching. Inline validation `isDateRangeValid()` is manual. Violates the layered architecture enforced by ArchUnit elsewhere. | `BarberController.java:21-23` | Maintenance — bypasses architecture |
| **H7** | **`NotificationController` returns unbounded results.** `findAllByOrderBySentAtDesc()` has no pagination, limit, or streaming. Loads all rows into memory as the outbox grows over time. DoS vector at scale. | `NotificationController.java:27-33` | Performance — unbounded memory |
| **H8** | **No explicit `ROLE_CUSTOMER` auth rules.** `/api/v1/customer/**` relies on the `.anyRequest().authenticated()` catch-all. Any authenticated user (including `ROLE_ADMIN`) could access customer endpoints. `CustomerController` filters by the authenticated user's email, so no data leak today — but future endpoints could forget role checks. | `SecurityConfig.java` | Defense-in-depth gap |
| **H9** | ~~**`lint:all` only lints mobile.**~~ **RESOVED.** The current `lint:all` script runs `npm --prefix frontend run lint && npm --prefix frontend run format:check && npm --prefix mobile run lint` — it validates both frontend and mobile. The AGENTS.md claim is correct. | `package.json:10` | ~~CI gap — frontend not validated~~ |
| **H10** | **Matcher-type inconsistency in SecurityConfig.** CSRF exemptions (lines 100-106) use explicit `PathPatternRequestMatcher.pathPattern()`, while authorization rules (lines 113-136) use default `AntPathRequestMatcher` via `.requestMatchers()` strings. `PathPatternRequestMatcher` and `AntPathRequestMatcher` have different semantics (`*` vs `**`, trailing slash handling). A path that matches one may not match the other, potentially leaving endpoints unprotected by either CSRF or authorization. | `SecurityConfig.java:100-136` | Security — path matching drift risk |
| **H11** | **EAS project ID is a placeholder.** `mobile/app.json` line 42 has `"projectId": "taskflow-mobile-app"` instead of a real UUID. Expo Updates and EAS Build will fail with this value. Also prevents `"autoIncrement": true` and `"appVersionSource": "remote"` from working. | `mobile/app.json:42` | Build failure — mobile CI/CD broken |
| **H12** | **`sync-api-types.js` is a no-op.** The script fetches the OpenAPI spec, validates it exists, prints "OpenAPI spec synced successfully" — but **never generates or writes TypeScript types** to `shared/types/api.ts`. The `TARGET_FILE` is checked for existence but never modified. `npm run sync:api-types` does nothing useful. Also has invalid shebang (`#!/text/node`). | `scripts/sync-api-types.js:1,34-57` | CI gap — contract validation is imaginary |
| **H13** | ~~**ADR-002 is outdated.**~~ **RESOVED.** ADR-002 has been updated to status "Superseded" and now documents G1GC as the production choice, matching AGENTS.md and the production config. | `docs/adr/ADR-002-parallelgc-selection.md` | ~~Documentation drift~~ |
| **H14** | **No offline/network state handling (mobile).** No `useNetInfo` or connectivity-aware logic anywhere. When offline: no visual indicator, failed mutations throw generic errors, notification polling generates continuous network errors. No retry/backoff beyond TanStack's default `retry: 1`. | All `mobile/src/` | UX — no graceful offline degradation |
| **H15** | **Missing `KeyboardAvoidingView` in all forms (mobile).** No screen wraps content in `KeyboardAvoidingView` or `KeyboardAwareScrollView`. On iOS, the soft keyboard occludes input fields at the bottom of the screen. Affects login, register, booking, schedules, and dashboard screens. | `LoginScreen.tsx`, `RegisterScreen.tsx`, `BookingScreen.tsx`, etc. | Usability — forms unusable on iOS |
| **H16** | **Zero accessibility support (mobile).** Not a single `accessibilityLabel`, `accessibilityHint`, `accessibilityRole`, or `accessible` attribute in the entire mobile codebase. Star rating picker, time slot buttons, and tab bar icons are completely invisible to screen readers. Legal compliance risk (ADA/WCAG). | All `mobile/src/` | Legal/compliance |
| **H17** | **Docker build context includes unnecessary data.** `shared/`, `mobile/`, `docs/`, `k6/`, `scripts/`, `jaeger/` are not in `.dockerignore`. Every backend Docker build sends several MB of irrelevant files to the Docker daemon. | `.dockerignore` | Build performance |

---

## MEDIUM (24 issues)

| # | Issue | Location |
|---|-------|----------|
| **M1** | **No `application-test.properties` exists.** All non-Testcontainers integration tests run against H2. The Testcontainers test is `@Disabled` by default. PostgreSQL dialect is never exercised in CI. | Missing file |
| **M2** | **`AppointmentServiceImplTest.testMaskMethodsThroughNotification()` has zero assertions.** Calls four methods, discards return values, never calls `verify()`. No-op test. | `.../AppointmentServiceImplTest.java:212-236` |
| **M3** | **No API base URL in `mobile/app.json` extra config.** No environment-switching mechanism. Changing between dev/staging/prod requires source code changes. | `mobile/app.json:40-44` |
| **M4** | **Content Security Policy disabled.** `angular.json` has `autoCsp: false`. No `<meta http-equiv="Content-Security-Policy">` in `index.html`. Angular has built-in template sanitization, but CSP is defense-in-depth against XSS vectors like `bypassSecurityTrust*` misuse or third-party script injection. | `angular.json:32`, `index.html` |
| **M5** | **Navigation briefly flashes GuestTabs after login (mobile).** `RootNavigator.useEffect` dispatches `['GuestTabs']` on every auth state change, including successful login. User sees the guest screen briefly before the correct role-based tabs render. | `RootNavigator.tsx:34-48` |
| **M6** | **Plaintext HTTP default for mobile API.** Fallback URLs are `http://10.0.2.2:8080` (Android) and `http://localhost:8080` (iOS) when `EXPO_PUBLIC_API_URL` is unset. Acceptable for local dev but no guardrail or build-time check prevents this from being used in production. | `client.ts:39-49` |
| **M7** | **No SSL/TLS certificate pinning (mobile).** Axios client has no pinning configuration. On rooted/jailbroken devices, MITM attacks can intercept API traffic including JWTs. | `client.ts` |
| **M8** | **Unbounded async thread pool limits.** `@EnableAsync` without custom `AsyncConfigurer` defaults to Spring Boot's auto-configured `ThreadPoolTaskExecutor` with core=8, max=`Integer.MAX_VALUE`, queue=`Integer.MAX_VALUE`. Under sustained high load, the pool can grow without practical bound. | `TaskflowApplication.java:14` |
| **M9** | **Mass assignment risk on `AppUser`.** Public setters for `passwordHash` and `role`. Any code with a reference to an entity can call `user.setRole("ROLE_ADMIN")` to escalate privileges. | `AppUser.java:47-60` |
| **M10** | **`@JsonTypeInfo(use = Id.CLASS)` on `AppointmentStats` DTO.** Leaks `@class` discriminator in API responses. Only needed for Redis cache serialization, not on the DTO itself. If any client deserializes with an unconstrained ObjectMapper, arbitrary classes could be instantiated. | `AppointmentStats.java:5` |
| **M11** | **No method-level security** (`@PreAuthorize`, `@Secured`) anywhere. All authorization is URL-pattern-only. New endpoints added without URL rules fall through to `anyRequest().authenticated()`. | All controllers |
| **M12** | **`LocalDateTime.now()` in `@PrePersist`/`@PreUpdate`.** `Appointment`, `AppUser`, and `Review` use `LocalDateTime.now()` directly. Time-dependent logic is impossible to test deterministically. Should inject a `Clock` bean. | `Appointment.java:98`, `AppUser.java:34`, `Review.java:33` |
| **M13** | **Hardcoded seed data dates in Flyway migrations.** `V2` and `V11` seed data uses hardcoded future dates (e.g., `2026-06-28`). Flyway migrations are immutable — these will eventually reference past dates, making "overdue" checks and UI display incorrect. | `V2__seed_appointments.sql`, `V11__provision_more_test_data.sql` |
| **M14** | **Duplicate design token systems.** Tailwind `@theme` (in `styles.css`), CSS custom properties in `:root` (in `app.css`), and platform-local `tokens.json` files all define color values independently. Updating tokens requires manual sync across multiple files. | `styles.css`, `app.css`, `frontend/src/theme/tokens.json`, `mobile/src/theme/tokens.json` |
| **M15** | **`ViewEncapsulation.None` on all components.** All CSS is globally scoped. High style collision risk as the app grows. | All frontend components |
| **M16** | **`onBarberOrDateChange` uses `getUTCDay()`.** Uses UTC day instead of local day for Sunday-check. Users behind UTC can select Sunday slots on Saturday locally. | `app.ts:623` |
| **M17** | **`console.error` calls in production code (frontend).** Leaks error details (status codes, response bodies) to browser console. | `app.ts:377-380`, `auth-modal.ts:284` |
| **M18** | **`dns-prefetch` and `preconnect` to `localhost:4200` in `index.html`.** Completely useless in production where the Nginx proxy serves the app. | `index.html:10-11` |
| **M19** | **Hardcoded role strings (mobile).** `'ROLE_ADMIN'` and `'ROLE_CUSTOMER'` used as raw string literals throughout. Should be constants/enum. | `HomeScreen.tsx:34,157,161`, `RootNavigator.tsx:61` |
| **M20** | **Duplicate category filter arrays (mobile).** `BookingScreen` defines `['all', 'HAIRCUTS', 'BEARD_TRIM', 'SHAVES', 'COMBOS']` but `CatalogScreen` has `['all', 'HAIRCUTS', 'BEARD_TRIM', 'SHAVES', 'TREATMENTS']`. Values differ (`COMBOS` vs `TREATMENTS`). | `BookingScreen.tsx:47`, `CatalogScreen.tsx:25` |
| **M21** | **Copy-pasted error extraction boilerplate (mobile).** Same 5-line `extractErrorMessage` pattern duplicated in `useAuthStore`, `BookingScreen`, `AdminSchedulesScreen`, `PublicCancelModal`, `PublicReviewModal`. | 5 files in `mobile/src/` |
| **M22** | **`FlatList` inside `ScrollView` (mobile).** `LookbookGallery` uses `FlatList` with `scrollEnabled={false}` inside a parent `ScrollView`. Defeats virtualization — all items render at once. | `HomeScreen.tsx:93`, `LookbookScreen.tsx:15` |
| **M23** | **`useCallback` never used (mobile).** Zero memoization across all components. Causes unnecessary re-renders, especially in list items (appointment cards, catalog cards, time slot buttons). | All `mobile/src/` |
| **M24** | **`CacheConfig` creates `ObjectMapper` three times.** The `redisObjectMapper()` static method is called three times creating three identical `ObjectMapper` instances. Should be a shared singleton. | `CacheConfig.java:58-66,85,96,102` |

---

## LOW (25+ issues)

| # | Issue | Location |
|---|-------|----------|
| **L1** | CSS animation class mismatch — `app.html:4` uses `animate-fade-in` (kebab-case), `app.css:277` defines `.animate-fadeIn` (camelCase). One non-functional animation. | `app.html:4`, `app.css:277` |
| **L2** | Duplicate time utility functions — `parseTimeToMinutes()` and `formatMinutesToTimeString()` reimplemented as private methods in `app.ts:676-694`, duplicating `frontend/src/app/time-utils.ts:26-47`. | `app.ts:676-694` |
| **L3** | Hardcoded service names and stylist profiles in frontend. | `lookbook.ts`, `app.ts:139-158` |
| **L4** | Hardcoded `$2.50` checkout fee in both frontend (`app.ts:585`) and mobile (`BookingScreen.tsx:145`). | `app.ts:585`, `BookingScreen.tsx:145` |
| **L5** | Hardcoded time slots and operating hours (mobile). `BookingScreen` has `TIME_SLOTS = ['09:00','10:00'...]` hardcoded. HomeScreen operating hours hardcoded. | `BookingScreen.tsx:45`, `HomeScreen.tsx:197-228` |
| **L6** | `isOverdue()` in the platform-local time utilities ignores the time component — only compares `YYYY-MM-DD`. An 11 PM appointment is marked overdue at midnight before the time passes. | `frontend/src/app/time-utils.ts:67-74`, `mobile/src/utils/time-utils.ts` |
| **L7** | `formatTime12Hour()` doesn't pad single-digit minutes — `"9:5"` becomes `"9:5 AM"` not `"9:05 AM"`. | `time-utils.ts:13` |
| **L8** | No `cancelled` status token in platform-local `tokens.json`. Any UI rendering a cancelled appointment must hardcode a color. | `frontend/src/theme/tokens.json`, `mobile/src/theme/tokens.json` |
| **L9** | `gradle.properties` suppresses config-cache problems (`problems=warn`). Masks Gradle 10 migration issues. | `gradle.properties:26` |
| **L10** | ~~**PostgreSQL version mismatch**~~ **RESOLVED.** `docker-compose.yml` now uses `postgres:18.6-alpine`, `start-docker.sh` labels the service as "PostgreSQL 18", and `BENCHMARKS.md` references PostgreSQL 18. The original audit misidentified the discrepancy — current sources consistently reference PostgreSQL 18. | `BENCHMARKS.md`, `docker-compose.yml` |
| **L11** | `verify.sh` auto-fixes formatting (runs `prettier --write`) during verification — unexpected side effect | `verify.sh:31-33` |
| **L12** | No `PrePush`/`PreCommit` hooks configured. Bad code reaches the remote before CI catches it. | (Process gap) |
| **L13** | `TaskflowApplicationTest.testMain()` calls `main()` with no assertions about the outcome. || `TaskflowApplicationTest.java:15-17` |
| **L14** | `LoginResponse.token` field is always `null` — dead field. | `LoginResponse.java:6-9` |
| **L15** | `BusySlotsService` silently returns "all slots busy" on any transient DB error, making the entire day unavailable. | `BusySlotsService.java:80-87` |
| **L16** | No rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) on successful requests. | `RateLimiterConfig.java:65` |
| **L17** | Tab navigator styles duplicated 3 times (mobile) — `GuestTabNavigator`, `CustomerTabNavigator`, `AdminTabNavigator` all copy identical `tabBarStyle`. | `GuestTabNavigator.tsx:16-38` etc. |
| **L18** | `eas.json` submit config is empty — `submit.production: {}`. Production app store submission cannot proceed. | `mobile/eas.json:37-39` |
| **L19** | No deep linking configuration (mobile) — the `PublicActions` screen has `publicId` params ideal for deep linking but no scheme configured. | `app.json`, `RootNavigator.tsx` |
| **L20** | `app.json` has no environment-specific configuration — no way to differentiate dev/staging/prod. | `mobile/app.json` |
| **L21** | Tab panel `aria-labelledby` references (`step-tab-1`, etc.) point to non-existent `<button>` IDs in the Angular booking wizard. | `app.html:290-291,385-386,434-435,614-615` |
| **L22** | SVG icons missing `aria-hidden="true"` attributes — screen readers attempt to parse SVG content. | Multiple locations in `app.html`, `admin-dashboard.html` |
| **L23** | Inconsistent form approaches — `@angular/forms/signals` used in booking wizard, `FormsModule`/`ngModel` used in auth modal and post-booking forms. | `app.ts:15`, `auth-modal.ts` |
| **L24** | TypeScript 7.x in mobile with no `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes` enabled. | `mobile/tsconfig.json` |
| **L25** | k6 thresholds extremely generous — TTFB < 2500ms, FCP < 3500ms, LCP < 6000ms. | `k6/browser.js:24-30` |
| **L26** | k6 uses `grafana/k6:latest-with-browser` (unpinned tag) in CI — version can change between runs. | `.github/workflows/k6.yml:30` |
| **L27** | `zap2sarif.py` only handles `<p>`, `</p>`, and `<br>` tags — all other HTML from ZAP is raw in SARIF output. | `scripts/zap2sarif.py:133-140` |
| **L28** | Multiple ADRs were flagged: ADR-002 recommended ParallelGC (**RESOLVED** — now documents G1GC), ADR-005 didn't mention double-submit CSRF (**RESOLVED** — updated to document the pattern). ADR index file was also missing (**RESOLVED** — added `docs/adr/README.md`). | `docs/adr/` |

---

## POSITIVE FINDINGS (Not Issues)

These are areas where the codebase is doing things right:

| Area | Strength |
|------|----------|
| **CSRF** | Double-submit pattern correctly implemented on both backend (`CookieCsrfTokenRepository`) and frontend (`withXsrfConfiguration`). |
| **Auth token storage** | JWT lives only in HttpOnly cookies (web) and `expo-secure-store` (mobile). **No `localStorage`/`sessionStorage`** for auth tokens. |
| **XSS prevention** | No `innerHTML`, `bypassSecurityTrust*`, or DOM sanitizer bypasses anywhere. Angular's template sanitization is used throughout. |
| **Memory management** | All Angular `subscribe()` calls use `takeUntilDestroyed()`. No `Thread.sleep()` in any test code. |
| **Mobile security** | `expo-secure-store` for native token storage (iOS Keychain / Android Keystore). Auto-logout on 401 interceptor. Zero-trust `checkAuth()` that never trusts local cache. |
| **Test coverage** | Mobile has **46 test files** covering API modules, stores, screens, and components — all with real assertions. Frontend has **9 spec files with 58 real tests** using `HttpTestingController` flush patterns. Backend has **35 test files** including ArchUnit architecture enforcement and benchmark tests. |
| **Container hardening** | Read-only root filesystems, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, numeric UIDs (`10001:10001`). |
| **Zero-trust network** | Frontend network physically cannot reach the database. Cache and DB on isolated `backend-tier`. |
| **Platform-local theme tokens** | `frontend/src/theme/tokens.json` and `mobile/src/theme/tokens.json` define the Obsidian & Gold design system. Consumed by Tailwind `@theme` (frontend) and `colors.ts` (mobile). |
| **Platform-local time utils** | `frontend/src/app/time-utils.ts` and `mobile/src/utils/time-utils.ts` each provide pure 12h/24h time and date utilities for their respective platforms. |

---

## SUMMARY

| Severity | Count | Key Themes |
|----------|-------|-----------|
| **Critical** | 3 | `@Transactional` bypass, event ordering, ephemeral crypto keys |
| **High** | 14 | Auth state desync, race conditions, CI gaps (EAS), security config drift, a11y & usability. (3 resolved: lint:all, sync-api-types, ADR-002) |
| **Medium** | 24 | Test gaps, CSP, mobile config, mass assignment, no method security, untestable time, token duplication |
| **Low** | 27+ | CSS, dead code, documentation drift, hardcoded values, missing ARIA, k6 config. (1 resolved: PostgreSQL version mismatch) |

**Total real issues: 68** (4 resolved since audit date)

**False positives identified and removed during review:** 1 (C4 — auth guard double navigation claim was incorrect)

**Gaps identified during review and added:** 8 (matcher inconsistency, EAS placeholder, missing test properties, dead test, missing env config, no git hooks, frontend tests unmentioned, main test no assertions)
