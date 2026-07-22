# Contributing to TaskFlow

## Quick Start

### Prerequisites
- Java 21 (OpenJDK)
- Node.js 20+
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

### Full-Stack Docker
```bash
./start-docker.sh        # Builds and starts all services via docker-compose
```

### Testing
```bash
./gradlew test           # Backend tests (requires Docker for Testcontainers)
cd frontend && npm test  # Frontend unit tests
cd frontend && npm run e2e  # Playwright E2E tests (starts its own dev server)
```

### Code Quality
- Frontend: Prettier (100 char width, single quotes). Run `npx prettier --write .` in `frontend/`.
- Backend: SpotBugs, ArchUnit, JaCoCo (80% coverage minimum).
- Security: OWASP Dependency Check (fails on CVSS >= 7).

## Project Structure
- `src/` — Spring Boot backend (Java 21, Gradle)
- `frontend/` — Angular 22 SPA (TypeScript, Tailwind CSS)
- `docs/adr/` — Architecture Decision Records

## Branches & PRs
- Main branch: `main`
- Create feature branches from `main`
- PRs require passing CI checks (build, test, lint, OWASP)
