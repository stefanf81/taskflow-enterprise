#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: ./verify.sh [--quick] [--stop-docker] [--help]

Default: lint, baseline/type checks, web/mobile coverage, backend check,
PostgreSQL tests, a fresh Docker build, and Playwright through nginx.
--quick        Skip PostgreSQL tests, Docker startup and Playwright.
--stop-docker  Compatibility flag: owned containers are always stopped.
--help         Show this help.

No source files are formatted or regenerated. Existing Compose containers
(even stopped ones) and occupied Compose ports are rejected, not taken over.
To fix formatting explicitly: npm --prefix frontend run format
Named volumes are preserved; E2E tests may change their application data.
The OpenAPI baseline is validated locally; live-backend drift remains a CI check.
EOF
}

QUICK=false
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    --stop-docker) ;; # Kept for existing callers; never authorizes taking over a stack.
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

GREEN='' RED='' NC=''
if [ -t 1 ] && [ -z "${NO_COLOR+x}" ]; then
  GREEN=$'\033[0;32m' RED=$'\033[0;31m' NC=$'\033[0m'
fi

OWN_STACK=false
LOCK_HELD=false
ACTIVE_PID=''
START_TIME=$SECONDS
CURRENT_STEP='preflight'
LOCK_DIR="${TMPDIR:-/tmp}/taskflow-verify-$(printf '%s' "$ROOT" | cksum | awk '{print $1}').lock"

# Give each asynchronous command its own process group. Signals can then stop
# npm/Gradle/startup descendants as well as their immediate wrapper process.
set -m
interrupt() {
  trap '' INT TERM
  if [ -n "$ACTIVE_PID" ]; then
    kill -TERM -- "-$ACTIVE_PID" 2>/dev/null || true
    wait "$ACTIVE_PID" 2>/dev/null || true
    ACTIVE_PID=''
  fi
  exit "$1"
}

cleanup() {
  local status=$?
  trap - EXIT
  trap '' INT TERM
  if [ "$OWN_STACK" = true ]; then
    if [ "$status" -ne 0 ]; then
      docker compose ps >&2 || true
      docker compose logs --no-color --tail 80 >&2 || true
    fi
    printf 'Stopping verification containers (preserving volumes)...\n'
    if ! ./stop-docker.sh; then
      printf 'Container cleanup failed; run ./stop-docker.sh manually.\n' >&2
      if [ "$status" -eq 0 ]; then status=1; CURRENT_STEP='container cleanup'; fi
    fi
  fi
  if [ "$LOCK_HELD" = true ]; then rmdir "$LOCK_DIR" || true; fi
  if [ "$status" -eq 0 ]; then
    printf '%sRequested checks passed (%ss).%s\n' "$GREEN" "$((SECONDS - START_TIME))" "$NC"
  else
    printf '%sVerification failed during %s (exit %s, %ss).%s\n' \
      "$RED" "$CURRENT_STEP" "$status" "$((SECONDS - START_TIME))" "$NC" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'interrupt 130' INT
trap 'interrupt 143' TERM

run_step() {
  CURRENT_STEP=$1
  shift
  local started=$SECONDS status=0
  printf '\n==> %s\n' "$CURRENT_STEP"
  "$@" &
  ACTIVE_PID=$!
  wait "$ACTIVE_PID" || status=$?
  ACTIVE_PID=''
  if [ "$status" -ne 0 ]; then
    if [ "$CURRENT_STEP" = 'workspace lint, types and formatting' ]; then
      printf 'For formatting failures, run explicitly: npm --prefix frontend run format\n' >&2
    fi
    return "$status"
  fi
  printf 'PASS: %s (%ss)\n' "$CURRENT_STEP" "$((SECONDS - started))"
}

for command in node npm java; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing prerequisite: %s\n' "$command" >&2
    exit 1
  fi
done
if [ ! -x ./gradlew ] || [ ! -d node_modules ]; then
  printf 'Run npm ci at the repository root (installs frontend, mobile and shared/schemas) and ensure ./gradlew is executable first.\n' >&2
  exit 1
fi
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  printf 'Another verification may be running. If not, remove the stale lock with: rmdir "%s"\n' "$LOCK_DIR" >&2
  exit 1
fi
LOCK_HELD=true

assert_fresh_stack() {
  local containers
  containers="$(docker compose ps --all --quiet)" || return 1
  if [ -n "$containers" ]; then
    printf 'Existing Compose containers found. Stop them with ./stop-docker.sh first.\n' >&2
    return 1
  fi
  # Read port bindings from Compose rather than duplicating them in this script.
  docker compose config --format json | node scripts/check-verification-ports.cjs
}

if [ "$QUICK" = false ]; then
  for command in docker curl psql; do
    command -v "$command" >/dev/null 2>&1 || { printf 'Missing prerequisite: %s\n' "$command" >&2; exit 1; }
  done
  [ -f .env ] || { printf 'Create .env from .env.example before full verification.\n' >&2; exit 1; }
  docker info >/dev/null
  docker compose version >/dev/null
  run_step 'fresh-stack preflight' assert_fresh_stack
fi

run_step 'workspace lint, types and formatting' npm run lint:all
run_step 'OpenAPI baseline validation (not live drift)' npm run api:spec:check
run_step 'generated API types' npm run sync:api-types:check
run_step 'frontend tests and coverage' npm --prefix frontend test -- --watch=false --coverage
run_step 'mobile security tests and coverage' npm --prefix mobile test -- --ci --coverage --maxWorkers=50%
run_step 'backend tests, coverage and static checks' ./gradlew check

if [ "$QUICK" = true ]; then
  printf '\nSKIPPED (--quick): PostgreSQL tests, Docker image build, ingress and Playwright.\n'
  exit 0
fi

# Rancher Desktop exposes a macOS client socket at ~/.rd/docker.sock, but Ryuk
# runs inside the Linux VM and must mount its /var/run/docker.sock instead.
# Keep the host connection untouched and always respect an explicit override.
if [ -z "${TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE+x}" ] && [ "$(uname -s)" = Darwin ]; then
  DOCKER_ENDPOINT="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
  case "$DOCKER_ENDPOINT" in
    unix://*/.rd/docker.sock)
      export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
      printf '\nRancher Desktop: using the VM Docker socket for Testcontainers cleanup.\n'
      ;;
  esac
fi
run_step 'PostgreSQL parity tests' ./gradlew testcontainersTest
# Recheck after the tests: never silently adopt a stack started in the meantime.
run_step 'fresh-stack ownership check' assert_fresh_stack
export APP_RATE_LIMIT_AUTH_MAX_REQUESTS_PER_MINUTE="${APP_RATE_LIMIT_AUTH_MAX_REQUESTS_PER_MINUTE:-200}"
# Set ownership before startup so even a partially failed Compose up is cleaned.
OWN_STACK=true
run_step 'fresh application build and startup' ./start-docker.sh

wait_for_ingress() {
  local timeout="${VERIFY_READY_TIMEOUT_SECONDS:-120}"
  if ! [[ "$timeout" =~ ^[1-9][0-9]*$ ]] || [ "${#timeout}" -gt 4 ] || [ "$timeout" -gt 3600 ]; then
    printf 'VERIFY_READY_TIMEOUT_SECONDS must be an integer from 1 to 3600.\n' >&2
    return 1
  fi
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl --fail --silent --show-error --max-time 3 http://localhost:4200/ >/dev/null 2>&1 &&
       curl --fail --silent --show-error --max-time 3 http://localhost:4200/api/v1/catalog >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  printf 'Nginx/API ingress did not become ready within %s seconds.\n' "$timeout" >&2
  return 1
}
run_step 'nginx/API readiness' wait_for_ingress
# CSP/SRI and both HTML shells are verified independently in e2e/csp.spec.ts.
run_step 'production-ingress Playwright tests' env E2E_DOCKER=true PLAYWRIGHT_HTML_OPEN=never npm --prefix frontend run e2e
