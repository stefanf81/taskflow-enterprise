# Contributing to TaskFlow

## Quick Start

### Prerequisites
- Git
- OpenJDK 21 (the Gradle wrapper supplies Gradle 9.7.1)
- Node.js 22.23.2 and npm 11.19.1 (mobile/.nvmrc pins the Node version)
- Docker Desktop with a running daemon for the Docker stack and PostgreSQL tests
- At least 5 GB available to Docker Desktop for the full Compose stack
- OpenSSL, needed to create the local Compose RSA key pair

For mobile native development, also install the platform-specific tools in
`mobile/development-set.md`. iOS builds require macOS with Xcode and CocoaPods;
Android builds require Android Studio, the Android SDK, and an emulator or device.

### Clone & Setup
```bash
git clone <repo-url>
cd taskflow
```

### Environment
```bash
cp .env.example .env
# Set POSTGRES_PASSWORD and SPRING_SECURITY_PASSWORD.
# For Docker Compose, generate and paste the required Base64 DER RSA keys as
# described in .env.example before starting the stack.
```

The root `.env` is required by Docker Compose and is ignored by Git. It is not
required for `./gradlew bootRun`, which uses the H2 development profile and
ephemeral signing keys by default.

### JavaScript Dependencies
Run these commands from the repository root. Installing the shared package
first keeps the local file dependency aligned with CI and the checked-in lockfiles.

```bash
(cd shared/schemas && npm ci)
(cd frontend && npm ci)
(cd mobile && npm ci)
npm run sync:api-types:check
```

### Backend (Spring Boot 4.1.1)
```bash
./gradlew test           # Fast H2-backed tests; Docker is not required
./gradlew build          # Compile, test, and package the application
./gradlew bootRun        # Start backend on :8080 (uses H2 in-memory DB for dev)
./gradlew testcontainersTest # PostgreSQL parity tests; Docker must be running
```

### Frontend (Angular 22)
```bash
(cd frontend && npm ci)  # Install locked dependencies
(cd frontend && npm start) # Dev server on :4200 (proxies /api to :8080)
```

Install the browser required by Playwright once per machine:

```bash
(cd frontend && npx playwright install chromium)
# Linux CI or Linux workstations may use:
# (cd frontend && npx playwright install --with-deps chromium)
```

### Mobile (React Native / Expo)
```bash
(cd mobile && npm ci)
(cd mobile && npm start) # Start Expo Metro Bundler
(cd mobile && npm test)  # Run Jest unit and component tests
(cd mobile && npm run lint) # Typecheck TypeScript
```

### Full-Stack Docker
```bash
./start-docker.sh        # Builds and starts all services via docker-compose
./stop-docker.sh         # Stops all docker-compose services
./verify.sh              # Runs full-stack verification (auto-starts Docker if needed & cleans up on exit)
```

### Testing
```bash
./gradlew test              # Backend H2 tests (does not require Docker)
./gradlew testcontainersTest # PostgreSQL tests (requires Docker)
cd frontend && npm test     # Frontend unit tests
cd frontend && npm run e2e  # Playwright E2E tests (starts its own dev server)
cd frontend && npm run e2e:docker  # Playwright E2E with auto-spinup and teardown of Docker stack
./verify.sh                 # Full verification; stops Docker only if it started the stack
./verify.sh --stop-docker   # Also stop a stack that was already running
```

`./start-docker.sh` builds the backend and frontend locally, builds the images,
and pulls `hadolint/hadolint` for Dockerfile linting on the first run. It needs
the configured `.env`, a running Docker daemon, and the resources listed above.
The default Dockerfile targets `linux/arm64` for Apple Silicon. Intel/AMD
machines can run it through Docker emulation, but the Compose file does not
automatically select `Dockerfile.x64`; adapt the Compose build configuration if
you need a native amd64 image.

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

### Dependency Updates

Renovate creates dependency-update PRs daily. Do not manually update a
Renovate branch. Patch and minor updates may automerge only after the required
CI checks pass; major, pin, digest, and lock-file-maintenance updates require
review.

The following ecosystems are intentionally grouped and review-only because their
members are version-coupled: Angular/toolchain, Spring Boot plugin/BOM, Flyway,
Hibernate, Netty, Log4j, Jackson, React Navigation, and React Native test
tooling.

Renovate excludes only the named direct Expo, React, React Native, and native
test dependencies in `mobile/package.json`; it does not infer the installed
SDK's full native-module matrix. Add an Expo-compatible native module with
`npx expo install <package>`. For an Expo SDK upgrade, first select the target
`expo` version, then align its compatibility set with:

```bash
cd mobile
npx expo install --fix
npx expo install --check
npx expo-doctor
```

Commit the resulting `package.json` and `package-lock.json` together, then run
the mobile test and native build suites.

## Project Structure
- `src/` — Spring Boot backend (Java 21, Gradle)
- `frontend/` — Angular 22 SPA (TypeScript, Tailwind CSS)
- `mobile/` — React Native / Expo application (TypeScript)
- `docs/adr/` — Architecture Decision Records

## Branches & PRs
- Main branch: `main`
- Create feature branches from `main`
- PRs require passing CI checks (build, test, lint, OWASP)
