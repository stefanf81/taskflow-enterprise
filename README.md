# TaskFlow

TaskFlow is a barbershop booking platform: customers book a service with a barber, the shop
approves or denies the booking and manages its barbers, schedules and service catalog.

| Path | What |
| --- | --- |
| `src/` | Spring Boot 4.1 / Java 25 backend: a Spring Modulith monolith (`appointment`, `auth`, `catalog`, `notification`, `review`, shared `core`), PostgreSQL + Flyway, Redis caching |
| `frontend/` | Angular 22 web app (zoneless, signals), Tailwind, prerendered landing page, Nginx config |
| `mobile/` | React Native / Expo app for Android and iOS |
| `shared/schemas/` | zod/mini request and response schemas used by both clients (`@taskflow/schemas`) |
| `shared/domain/` | Booking rules and time helpers both clients apply (`@taskflow/domain`) |
| `api/openapi.json` | Reviewed OpenAPI baseline; both clients' API types are generated from it |
| `docs/` | Rules by area (`docs/agents/`), ADRs, benchmarks, hardening policy, CI design |

This page gets a checkout running. The rules for changing the code live in
[AGENTS.md](AGENTS.md) and [docs/agents/](docs/agents/); see [Where to read next](#where-to-read-next).

## Prerequisites

- Git and OpenSSL (for the local JWT key pair).
- JDK 25. Gradle comes from the checked-in wrapper; without a local JDK 25 the foojay
  toolchain resolver downloads one. Local Android Detox builds still use JDK 21
  (`mobile/e2e/README.md`).
- Node.js 26.13.0 and npm 12.2.1 (`mobile/.nvmrc`, `packageManager` in `frontend/package.json`).
- For the full stack: Docker Engine 25+ (Compose 2.20.2+, the health checks use
  `start_interval`) with at least 5 GB for Docker.
- For native mobile work: Xcode and CocoaPods (macOS) or Android Studio with an SDK and an
  emulator or device; see `mobile/development-set.md`.

## Install

```bash
git clone <repo-url>
cd <repo-directory>
npm ci
```

`frontend`, `mobile`, `shared/schemas` and `shared/domain` are npm workspaces with one lockfile at
the root, so this single `npm ci` installs all of them. Always use `npm ci`, never `npm install`. To
install one app only: `npm ci --workspace frontend --workspace shared/schemas` (or
`--workspace mobile`).

For the Docker stack, create `.env` and fill in the placeholders, including the Base64 DER
RSA key pair described in the file (Compose runs the backend with the `prod` profile,
which requires persistent keys). Never commit `.env` or the keys.

```bash
cp .env.example .env
```

## Run

Backend and web without Docker (H2 database, throwaway JWT keys):

```bash
./gradlew bootRun              # terminal 1: API on http://localhost:8080
(cd frontend && npm start)     # terminal 2: web on http://localhost:4200, proxies /api
```

Default development credentials are `admin` / `admin-password`.

Full stack (PostgreSQL, Redis, backend and Nginx) in Docker:

```bash
./start-docker.sh              # web on http://localhost:4200
./stop-docker.sh               # stops the stack, keeps the volumes
```

Mobile (Expo Go is not supported: `expo-secure-store` is a native module):

```bash
cd mobile
cp .env.example .env           # adjust the API URL if needed
npx expo prebuild --platform android   # or ios, on macOS; first run only
npm run android                # or: npm run ios
```

## Check a change

```bash
./gradlew check                # backend tests (H2), coverage, SpotBugs, container guards
npm run lint:all               # ESLint, tsc, Prettier, component maps, dependency tree
npm run test:all               # frontend and mobile unit tests
npm run sync:api-types:check   # generated API types match api/openapi.json
./verify.sh --quick            # all of the above in one go; drop --quick for the full stack
```

`./gradlew testcontainersTest` runs the PostgreSQL tests and needs Docker. Playwright needs
a browser once: `(cd frontend && npx playwright install chromium)`. CONTRIBUTING.md
explains what `./verify.sh` does in full mode and the API contract workflow.

## Where to read next

- [AGENTS.md](AGENTS.md): the short list of rules that are easy to break, with commands.
- [docs/agents/](docs/agents/): the rules and their reasons by area (backend, domain,
  security, frontend, mobile, contracts, infrastructure, CI, gotchas).
- [CONTRIBUTING.md](CONTRIBUTING.md): workflow, tests, API contract changes, dependency updates.
- [ARCHITECTURE.md](ARCHITECTURE.md): system overview and request flow.
- [docs/adr/](docs/adr/README.md): architecture decisions (ADR-001…).
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md) and [docs/SYSTEM-HARDENING.md](docs/SYSTEM-HARDENING.md):
  measurements and the hardening policy.
- [docs/ci/](docs/ci/README.md): the CI workflows and why they are built that way.
- [frontend/README.md](frontend/README.md), [mobile/README.md](mobile/README.md): per-app notes.
- Open work is tracked in [GitHub issues](https://github.com/stefanf81/taskflow-enterprise/issues);
  [docs/TODO.md](docs/TODO.md) keeps the resolved findings.

Production manifests live in a separate GitOps repository (`homelab/TF/gitops/apps/taskflow/`).
