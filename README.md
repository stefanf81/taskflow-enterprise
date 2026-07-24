# TaskFlow Enterprise Suite

**TaskFlow** is a modern, high-performance, full-stack appointment management and luxury salon booking platform.

The suite comprises three core components:
1. **Spring Boot 3.5 Backend (Java 21):** REST API server providing business logic, authentication, PostgreSQL persistence, Flyway migrations, and Redis caching.
2. **Angular 22 Web Frontend:** Modern Angular Signals web application with Tailwind CSS gold & obsidian design system.
3. **React Native + Expo Mobile Application (`mobile/`):** Cross-platform native mobile application for Android (phones & tablets) and iOS (iPhone & iPad).

---

## 🏛 Architecture Overview

```text
                               ┌──────────────────────────────────┐
                               │     Angular 22 Web Frontend      │
                               │        (frontend/ - Port 4200)   │
                               └────────────────┬─────────────────┘
                                                │
                                                │ REST API (JSON)
                                                ▼
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│  React Native Mobile Application │  │   Spring Boot 3.5 Backend REST   │
│     (mobile/ - Android & iOS)    ├─►│         (Java 21 - Port 8080)    │
└──────────────────────────────────┘  └────────────────┬─────────────────┘
                                                       │
                                          ┌────────────┴────────────┐
                                          ▼                         ▼
                                ┌──────────────────┐      ┌──────────────────┐
                                │ PostgreSQL 16 DB │      │   Redis Cache    │
                                └──────────────────┘      └──────────────────┘
```

---

## 📂 Project Structure

```text
.
├── src/                          # Spring Boot 3.5 Backend (Java 21 / Gradle)
│   └── main/java/com/example/taskflow/
│       ├── appointment/          # Appointment domain, controllers, services
│       ├── auth/                 # RSA-2048 JWT authentication & security config
│       ├── catalog/              # Service catalog management
│       ├── notification/         # Notification outbox relay
│       └── review/               # Barber ratings & review management
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
│   │   ├── store/                # Zustand stores (useAuthStore, useUIStore)
│   │   └── utils/                # expo-secure-store wrapper
│   ├── app.json                  # Expo App configuration
│   └── eas.json                  # EAS Build profiles (Android APK/AAB, iOS IPA)
├── docs/                         # Architectural Decision Records (ADRs)
│   └── adr/
├── docker-compose.yml            # Local Docker orchestrator
├── start-docker.sh               # One-click Docker launcher script
├── stop-docker.sh                # Docker cleanup script
├── verify.sh                     # Full-stack quality verification (with auto-docker lifecycle)
└── ARCHITECTURE.md               # End-to-End Architectural Blueprint
```

---

## 🚀 Quick Start Guide

### 1. Run via Docker Compose (Full Stack)
```bash
./start-docker.sh
```
This launches the PostgreSQL database, Redis cache, Spring Boot backend, and Nginx frontend in health-checked isolated Docker networks.

* **Web UI:** `http://localhost:4200`
* **Backend API:** `http://localhost:8080`
* **Prometheus Metrics:** `http://localhost:8080/actuator/prometheus`
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
* **Read-Only Filesystems:** Containers run with `read_only: true` with ephemeral `/tmp` mounted as `tmpfs`.
* **Dropped Kernel Capabilities:** All containers explicitly execute with `cap_drop: [ALL]` and `no-new-privileges:true`.
* **Container Lifecycle:** Services use `restart: "no"` in `docker-compose.yml` to prevent lingering background containers. Verification and test scripts (`./verify.sh`, `npm run e2e:docker`) register exit traps to automatically stop containers upon completion.
* **Hardware Token Security:** Mobile app stores JWT tokens in **iOS Keychain** & **Android Keystore** via `expo-secure-store`.
* **HttpOnly Cookies:** Web app uses `HttpOnly`, `SameSite=Strict` cookies with double-submit CSRF token protection.

---

## 📚 Documentation & ADRs

* [ARCHITECTURE.md](ARCHITECTURE.md) — Detailed end-to-end data flow and architectural analysis
* [AGENTS.md](AGENTS.md) — Developer guidelines and AI agent instructions
* [SYSTEM-HARDENING.md](SYSTEM-HARDENING.md) — Zero-trust security & container hardening policy
* [docs/adr/](docs/adr/) — Architecture Decision Records (ADRs)
  * `ADR-001` — Virtual Threads Disabled
  * `ADR-002` — Parallel GC Selection
  * `ADR-003` — Denormalized Customer Name
  * `ADR-004` — Redis for Distributed Caching
  * `ADR-005` — JWT in HttpOnly Cookie
  * `ADR-006` — Migration to React Native & Expo Mobile Application
