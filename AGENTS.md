# TaskFlow — Agent Instructions

## Project Structure

- **Backend**: Spring Boot 3.5.3 / OpenJDK 21 / Gradle — `src/main/java/com/example/taskflow/`
  - High-Performance Tunings: Spring Boot AOT enabled, 1GB fixed heap, Virtual Threads disabled (Platform threads used), Jackson Blackbird, Asynchronous Logging, OpenTelemetry 10% sampling, Caffeine local cache.
  - Runtime Profiles & Multi-Arch JVM Optimization:
    - **Local (Apple Silicon M4 Pro):** Optimized via native `Dockerfile` using ParallelGC (`-XX:+UseParallelGC`, `-XX:ParallelGCThreads=10`, `-XX:+UseSIMDForMemoryOps` vectorizations).
    - **Production (AMD Ryzen 5 7430U):** Cross-compiled via `Dockerfile.x64` using ParallelGC (`-XX:+UseParallelGC`, `-XX:ParallelGCThreads=6`, and the corrected integer JVM syntax `-XX:UseAVX=2` for 256-bit Zen 3 Advanced Vector Extensions).
  - Packages: `controller`, `service`, `repository`, `dto`, `security`, `config`, `exception`, `model`
  - Entry point: `TaskflowApplication.java`
- **Frontend**: Angular 22 / TypeScript / Tailwind CSS — `frontend/`
  - Entry: `frontend/src/main.ts`, app module: `frontend/src/app/`
  - Auth: `auth.interceptor.ts` (Bearer JWT from `sessionStorage`), `auth.guard.ts`
- **DB**: Flyway migrations in `src/main/resources/db/migration/`
- **K8s manifests**: `kubernetes/` (namespace, backend, frontend, postgres, configmap, network policy)

## Commands

### Backend (root)
```
./gradlew build          # compile + test
./gradlew test           # unit + integration tests (Testcontainers for PostgreSQL)
./gradlew check          # test + OWASP dependency check (fails on CVSS >= 7)
./gradlew processAot bootJar # build AOT optimized application
./gradlew bootRun        # run backend locally (uses H2 by default)
```

### Frontend (`frontend/`)
```
npm start                # Angular dev server on :4200
npm test                 # unit tests (vitest via Angular builder)
npm run e2e              # Playwright E2E (spins up dev server via webServer config)
npm run build            # production build
```

### Full-stack Docker
```
./start-docker.sh        # docker compose up (db → backend → frontend, health-checked)
./stop-docker.sh         # docker compose down
```

### Kubernetes (k3d)
```
./start-k3d.sh           # builds images → creates k3d cluster → imports images → applies manifests
./stop-k3d.sh            # deletes k3d cluster + kubeconfig
# After start-k3d.sh:
KUBECONFIG=k3d-kubeconfig.yaml kubectl get pods -n taskflow
```

### Security
```
./run-dast-scan.sh       # spins up compose, runs OWASP ZAP against OpenAPI spec, writes zap_report.html
```

## Key Conventions

- **DB**: H2 in dev/test, PostgreSQL in prod (docker-compose / K8s). Flyway handles migrations — never use `ddl-auto=update`. All profiles use `ddl-auto=validate`.
- **Container Hardening & Zero-Trust**:
  - **Numeric UIDs**: Backend containers are configured with a hardcoded, unprivileged numeric UID (`10001:10001`) to comply with strict Kubernetes Pod Security Standards (PSS).
  - **Zero-Trust Networks**: `docker-compose.yml` isolates the DB and Cache on the `backend-tier` network. The Nginx reverse proxy is on the `frontend-tier`. The backend bridges both. The frontend cannot physically talk to the database.
  - **Read-Only Root**: Containers mount read-only filesystems with ephemeral directories mounted as `tmpfs` (e.g., `/tmp`, `/var/cache/nginx`), preventing runtime binary tampering.
  - **Dropped Capabilities**: All services completely drop kernel privileges (`cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`).
- **OSIV is off** (`spring.jpa.open-in-view=false`) — connections return to Hikari pool immediately after service methods.
- **Auth**: Stateless JWT (Asymmetric RSA-2048 signing via OAuth2 Resource Server). Frontend stores token in `sessionStorage`, `auth.interceptor.ts` attaches `Authorization: Bearer` to every request. `/api/v1/auth/**` is the only public endpoint path.
- **Frontend uses Angular 22 Signals** (no Zone.js digest loops). Styles use Tailwind with custom `gold`/`obsidian` color palette.
- **Prettier** is the formatter (100 char width, single quotes). Run `npx prettier --write <file>` in `frontend/`.
- **Testcontainers** are used for PostgreSQL integration tests. They require Docker to be running.
- **ArchUnit** enforces package-level architecture constraints (`src/test/java/com/example/taskflow/architecture/`).
- **Default credentials**: `admin` / `admin-password` (overridden by `SPRING_SECURITY_PASSWORD` env var).
- **Nginx** frontend container runs on unprivileged port 8080 (mapped from host 4200).

## Gotchas

- `./gradlew test` requires Docker (Testcontainers).
- `./gradlew check` includes OWASP dependency check — build will fail if any dependency has CVSS >= 7.
- `start-k3d.sh` deletes any existing `taskflow-cluster` and overwrites `k3d-kubeconfig.yaml`. Do not run alongside other k3d clusters using the same name.
- The `.env` file (from `.env.example`) is required by docker-compose. Change default passwords before production use.
- Frontend `dist/` and `node_modules/` are gitignored. Do not commit build artifacts.
- E2E tests (`npm run e2e`) start their own dev server — don't run `npm start` separately when running e2e.
