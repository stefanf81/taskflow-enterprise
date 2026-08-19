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
├── docker-compose.yml            # Local Docker orchestrator
├── start-docker.sh               # One-click Docker launcher script
├── stop-docker.sh                # Docker cleanup script
├── verify.sh                     # Full-stack quality verification (with auto-docker lifecycle)
└── ARCHITECTURE.md               # End-to-End Architectural Blueprint
```

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

* **Web UI:** `http://localhost:4200`
* **API via Nginx:** `http://localhost:4200/api`
* **Prometheus Metrics:** Internal backend endpoint requiring ADMIN authentication — JWT cookie or bearer token
* **Stop Application Stack:** `./stop-docker.sh`
* **Full-Stack Automated Verification:** `./verify.sh` (automatically starts Docker if needed and cleans up on exit)

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

---

## 📚 Documentation & ADRs

* [ARCHITECTURE.md](ARCHITECTURE.md) — Detailed end-to-end data flow and architectural analysis
* [AGENTS.md](AGENTS.md) — Developer guidelines and AI agent instructions
* [SYSTEM-HARDENING.md](SYSTEM-HARDENING.md) — Zero-trust security & container hardening policy
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
