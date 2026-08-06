# Contributing to TaskFlow

## Quick Start

### Prerequisites
- Java 21 (OpenJDK)
- Node.js 22+
- Docker Desktop (for Testcontainers and docker-compose)
- npm 11+

### Clone & Setup
```bash
git clone <repo-url>
cd taskflow
```

### Environment
```bash
cp .env.example .env
# Edit .env if needed (defaults work for local dev)
```

### Backend (Spring Boot 4.1.0)
```bash
./gradlew build          # Full build including tests
./gradlew bootRun        # Start backend on :8080 (uses H2 in-memory DB for dev)
```

### Frontend (Angular 22)
```bash
cd frontend
npm install              # Install dependencies
npm start                # Dev server on :4200 (proxies /api to :8080)
```

### Mobile (React Native / Expo)
```bash
cd mobile
npm install
npm start                # Start Expo Metro Bundler
npm test                 # Run Jest unit and component tests
npm run lint             # Typecheck TypeScript
```

### Full-Stack Docker
```bash
./start-docker.sh        # Builds and starts all services via docker-compose
./stop-docker.sh         # Stops all docker-compose services
./verify.sh              # Runs full-stack verification (auto-starts Docker if needed & cleans up on exit)
```

### Testing
```bash
./gradlew test              # Backend tests (requires Docker for Testcontainers)
cd frontend && npm test     # Frontend unit tests
cd frontend && npm run e2e  # Playwright E2E tests (starts its own dev server)
cd frontend && npm run e2e:docker  # Playwright E2E with auto-spinup and teardown of Docker stack
./verify.sh                 # Full verification suite with auto-start and auto-cleanup of Docker
```

### API Contract Changes
The reviewed `api/openapi.json` file is the API compatibility baseline. When a backend endpoint or DTO changes intentionally:

```bash
./gradlew bootRun                  # In a separate terminal; OpenAPI docs require admin auth
npm run api:spec:update            # Refresh the reviewed baseline from the live backend
npm run sync:api-types             # Regenerate web and mobile API types
npm run sync:api-types:check       # Confirm generated files are committed and current
```

CI authenticates to the development backend, compares its live OpenAPI document with this baseline, and fails on unreviewed API changes. Commit the updated baseline and generated type files together.

### Admin SSE Changes
The admin dashboard receives appointment invalidation events from
`GET /api/v1/appointments/events`. When changing appointment mutations or stream
behavior:

- Keep event payloads immutable and free of customer PII.
- Publish mutation signals inside the transaction, but deliver them only with
  `@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)`.
- Keep the REST appointment query authoritative; SSE should trigger a reload rather
  than maintain a second appointment state model.
- Preserve cookie authentication. Never put the JWT in an `EventSource` URL.
- Test the stream through Nginx because buffering and idle timeouts affect delivery.
- Remember that the current emitter registry is single-instance. Add shared fanout
  and replay before enabling multiple backend replicas.

Run the focused tests while developing:

```bash
./gradlew test --tests '*AppointmentEventStreamServiceTest'
cd frontend && npm test -- --include src/app/admin-events.service.spec.ts
```

### Code Quality
- Frontend: Prettier (100 char width, single quotes). Run `npx prettier --write .` in `frontend/`.
- Backend: SpotBugs, ArchUnit, JaCoCo (80% coverage minimum).
- Security: OWASP Dependency Check (fails on CVSS >= 7).
- API contracts: The OpenAPI baseline and generated client type files must both be current.

## Project Structure
- `src/` — Spring Boot backend (Java 21, Gradle)
- `frontend/` — Angular 22 SPA (TypeScript, Tailwind CSS)
- `mobile/` — React Native / Expo application (TypeScript)
- `docs/adr/` — Architecture Decision Records

## Branches & PRs
- Main branch: `main`
- Create feature branches from `main`
- PRs require passing CI checks (build, test, lint, OWASP)
