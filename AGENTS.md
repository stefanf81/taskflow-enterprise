# TaskFlow — Agent Instructions

## Project Structure

- **Backend**: Spring Boot 4.1.0 / OpenJDK 21 / Gradle — `src/main/java/com/example/taskflow/`
  - High-Performance Tunings: Spring Boot AOT enabled, container-portable heap sizing (1GB fixed heap locally, `MaxRAMPercentage` in production), Virtual Threads disabled (Platform threads used), Jackson 3, Lazy Connection Fetching, Asynchronous Logging, OpenTelemetry 10% sampling, Redis-backed caching (Spring Cache abstraction).
  - Runtime Profiles & Multi-Arch JVM Optimization:
    - **Local (Apple Silicon M4 Pro):** Optimized via native `Dockerfile` using ParallelGC with a fixed 1GB heap (`-Xms1g -Xmx1g`) and `-XX:+AlwaysPreTouch` for predictable startup. Off-heap memory is bounded via `-XX:MaxDirectMemorySize=256m` and `-XX:MaxMetaspaceSize=256m`.
    - **Production (AMD Ryzen 5 7430U):** Cross-compiled via `Dockerfile.x64` using container-portable sizing — the heap scales to the orchestrator's cgroup limit (`-XX:MaxRAMPercentage`), and CPU-pinned GC/AVX flags are deliberately omitted so the JVM reads the container's actual CPU allocation. Off-heap memory is bounded the same way. The k8s `backend.yaml` sets `MaxRAMPercentage=60.0` via `JAVA_TOOL_OPTIONS`, overriding the image default.
  - Packages: `controller`, `service`, `repository`, `dto`, `security`, `config`, `exception`, `model`
  - Entry point: `TaskflowApplication.java`
- **Frontend**: Angular 22 / TypeScript / Tailwind CSS — `frontend/`
  - Entry: `frontend/src/main.ts`, app module: `frontend/src/app/`
  - Auth: Stateless JWT in an HttpOnly `access_token` cookie (RSA-2048 asymmetric, OAuth2 Resource Server). `auth.interceptor.ts` attaches the CSRF header; `auth.guard.ts` is a `canActivateFn` that gates the `/admin` and `/customer` dashboards. The principal's role is restored from the backend via `GET /api/v1/auth/me` (reads the cookie) into an **in-memory** signal (`AuthState`) — it is never trusted from `sessionStorage`/`localStorage`. Note: `app.config.ts` uses `withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', ... })` while the backend sets the CSRF cookie as `access_token`; reconcile the cookie name before relying on double-submit CSRF.
- **DB**: Flyway migrations in `src/main/resources/db/migration/`
- **K8s manifests**: `k3d/` (namespace, backend, frontend, postgres, configmap, network policy)

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

### Developer Environment
```
./update-mcp.sh          # High-performance, concurrent OpenCode MCP and developer tool updater (Go, NPM, uv). Uses strict mode and atomic execution locks.
```

### Local AI & Developer Agent Stack (LM Studio & Opencode)

To maintain absolute data privacy, cost efficiency, and low-latency development iteration, the coding agents are backed by a local, high-performance LLM stack run via **LM Studio** and orchestrated by **Opencode**.

*   **Primary Reasoning Model:** Qwen 35B MTP (`qwen3.6-35b-a3b-mtp`), loaded with native Multi-Token Prediction (MTP) speculative decoding for extremely high inference speeds.
*   **API Protocol:** OpenAI-compatible local endpoint on `http://localhost:1234/v1`.
*   **UI Integration & Collapsible Thoughts:** The model is configured inside `~/.config/opencode/opencode.jsonc` with `"reasoning": true` to separate internal `<think>` reasoning strings from the final coding outputs. Opencode renders these steps in native collapsible panels.
*   **Credentials Hardening:** Plaintext API keys or tokens are banned in configurations. The GitHub Personal Access Token is dynamically injected via Opencode's env substitution: `"GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_PERSONAL_ACCESS_TOKEN}"`.
*   **Configuration Backups:** 
    - Opencode LLM parameters: Saved in `llm-config.json`
    - LM Studio Model loading parameters: Saved in `lmstudio-qwen-config.json`

### Full-stack Docker
```
./start-docker.sh        # docker compose up (db → backend → frontend, health-checked)
./stop-docker.sh         # docker compose down
```

### Kubernetes (k3d)
```
./k3d/start-k3d.sh    # builds images → creates k3d cluster → imports images → applies manifests
./k3d/stop-k3d.sh     # deletes k3d cluster + kubeconfig
# After ./k3d/start-k3d.sh:
KUBECONFIG=k3d-kubeconfig.yaml kubectl get pods -n taskflow
```

### Security
Security scans (filesystem lints, container image vulnerability scans, and DAST OpenAPI security scans) are automated and executed directly within GitHub Actions to maintain lightweight local environments.

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
- `k3d/start-k3d.sh` deletes any existing `taskflow-cluster` and overwrites `k3d-kubeconfig.yaml`. Do not run alongside other k3d clusters using the same name.
- The `.env` file (from `.env.example`) is required by docker-compose and is git-ignored — copy `.env.example` to `.env` and adjust as needed. Change default passwords before production use.
- Frontend `dist/` and `node_modules/` are gitignored. Do not commit build artifacts.
- E2E tests (`npm run e2e`) start their own dev server — don't run `npm start` separately when running e2e.
