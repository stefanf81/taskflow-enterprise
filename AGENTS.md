# TaskFlow — Agent Instructions

Barbershop booking platform: Spring Boot backend, Angular web app, React Native mobile app, one shared contract.
This file is the short version. The detail (and the reasoning behind each rule) lives in `docs/agents/`; read the
matching file before changing that area.

## Layout

| Path | What | Detail |
| --- | --- | --- |
| `src/main/java/com/example/taskflow/` | Spring Boot 4 / Java 25 / Gradle modular monolith: `appointment`, `auth`, `catalog`, `notification`, `review`, shared `core` | [backend](docs/agents/backend.md), [domain](docs/agents/domain.md), [security](docs/agents/security.md) |
| `src/main/resources/db/` , `src/main/java/db/migration/` | Flyway SQL and Java migrations | [domain](docs/agents/domain.md) |
| `frontend/` | Angular 22 (zoneless, signals), Tailwind, prerendered landing page | [frontend](docs/agents/frontend.md) |
| `mobile/` | React Native / Expo, React Navigation, TanStack Query, Zustand | [mobile](docs/agents/mobile.md) |
| `shared/schemas/` | zod/mini request and response schemas used by both clients (`@taskflow/schemas`) | [contracts](docs/agents/contracts.md) |
| `api/openapi.json` | Reviewed OpenAPI baseline; both clients' `types/api.ts` are generated from it | [contracts](docs/agents/contracts.md) |
| `Dockerfile`, `docker-compose.yml`, `frontend/nginx*.conf` | One Dockerfile, two targets (`prod`, `local`) | [infrastructure](docs/agents/infrastructure.md) |
| `.github/` | Workflows and composite actions | [ci](docs/agents/ci.md) |
| `docs/adr/` | Architecture decisions (ADR-001…) | |
| `docs/BENCHMARKS.md`, `docs/SYSTEM-HARDENING.md` | Measurements (`§n` references) and the hardening policy | |
| `ARCHITECTURE.md` | System overview and diagrams | |

Production manifests live in a separate repository (`homelab/TF/gitops/apps/taskflow/`), not here.
Surprises are collected in [gotchas](docs/agents/gotchas.md).

## Commands

```bash
# Backend (root)
./gradlew build                 # compile + test
./gradlew test                  # unit + H2 integration tests (no Docker)
./gradlew testcontainersTest    # tagged PostgreSQL tests (needs Docker)
./gradlew containerConfigTest   # Dockerfile/compose/nginx/workflow guards (part of check)
./gradlew check                 # tests, coverage, container guards, SpotBugs (not OWASP)
./gradlew dependencyCheckAnalyze  # explicit OWASP scan (fails on CVSS >= 7)
./gradlew bootRun               # run locally on H2

# Frontend (frontend/)
npm start | npm test | npm run lint | npm run build | npm run e2e

# Mobile (mobile/)
npm start | npm test | npm run lint

# Whole repo (root)
npm run lint:all                # frontend ESLint + tsc + Prettier, mobile tsc
npm run test:all                # frontend + mobile unit tests
npm run api:spec:update         # refresh api/openapi.json from a running local backend
npm run sync:api-types          # regenerate both clients' API types (and :check to verify)

# Full stack
./start-docker.sh | ./stop-docker.sh
./verify.sh [--quick]           # full verification; --quick skips PostgreSQL and E2E
```

Default dev/test credentials are `admin` / `admin-password`; `.env` (from `.env.example`) is required by compose.

## Rules that are easy to break

Backend
- Flyway only, `ddl-auto=validate` everywhere. Never edit a released migration; there is deliberately no V16.
- Authorization is deny-by-default: a new endpoint needs an explicit `SecurityConfig` rule, a `HEAD` twin for every `GET`, `@PreAuthorize` if admin-only, and a case in `SecurityAuthorizationIntegrationTest`.
- Inject the `Clock`; never call no-arg `now()`. Raw SQL inserts into `appointments` must supply `booking_end_time`.
- Never persist the "No Preference" sentinel; resolve it to a real barber inside the booking transaction.
- Cache TTLs, `Cache-Control` and the `ShallowEtagHeaderFilter` must stay aligned; caches fail open (Redis errors never fail a request).
- No customer data in logs or traces.
- Prod fails fast without `APP_TRUSTED_PROXY_REGEX` and `APP_CORS_ALLOWED_ORIGINS`.

Containers
- JVM heap/GC sizing belongs to the deployment's `JAVA_TOOL_OPTIONS`, never to the image `CMD`.
- No `HEALTHCHECK` on the `prod` target or any stage it inherits; the `local` target keeps it.
- Default-profile startup must stay offline: the AOT cache training boots the app under `--network=none`.

CI
- Pin every third-party action to a full commit SHA with a `# vX.Y.Z` comment; GitHub-owned `actions/*` stay on tags.
- A job that must run after a skipped `needs` starts with `!cancelled()`, never `always()`.

Frontend
- Never read `httpResource().value` directly in a computed or template (it throws in error state); use `safeResourceValue` and gate on `error()`/`hasValue()`.
- Guest endpoints are marked with the `PUBLIC_REQUEST` token, not matched by URL.
- The `access_token` cookie is HttpOnly and never read by JavaScript; the role lives only in the in-memory `AuthState`.
- The landing page must not import `BookingStore` (it pulls Signal Forms into `main.js`); use `LookbookSelectionBus`.
- Edit `src/theme/tokens.json`, not `tokens.generated.css`. Schemas use `zod/mini`; keep the check order, since it decides `issues[0]`.
- Prettier: 100 columns, single quotes, run from `frontend/`.

Mobile
- Public calls go through `src/api/publicEndpoints.ts`; follow the Rules of React (the compiler bails out silently, `reactCompiler.test.ts` catches it).
- Subscribe to the auth store with per-field selectors, never the whole store. No bulk Prettier runs (mobile has no `.prettierrc`).

Contracts
- After any backend DTO or endpoint change: start the backend, `npm run api:spec:update`, `npm run sync:api-types`, commit the baseline and both generated files, then run `npm run sync:api-types:check`.
- Porting a feature between web and mobile: look it up in `frontend/src/component-map.json` / `mobile/src/component-map.json` and follow `.opencode/skills/sync-to-mobile.md`. Finish with `npm run lint:all` and `npm run test:all`.

## Writing to this file

Keep `AGENTS.md` under ~10 KB. Put rationale, measurements and history in an ADR (`docs/adr/`), `docs/BENCHMARKS.md` or the matching `docs/agents/*.md`, and leave only the rule and a pointer here.
