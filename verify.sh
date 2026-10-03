#!/usr/bin/env bash
set -euo pipefail

# Color Codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Cleanup hook configuration
AUTO_STOP_DOCKER="${AUTO_STOP_DOCKER:-false}"
STARTED_DOCKER=false

# The Playwright suite shares one client IP; its auth calls (me/csrf/login/
# register/logout) would exhaust the production 20/min auth bucket mid-run.
# Raise the bucket for this local verification stack only.
export APP_RATE_LIMIT_AUTH_MAX_REQUESTS_PER_MINUTE="${APP_RATE_LIMIT_AUTH_MAX_REQUESTS_PER_MINUTE:-200}"

for arg in "$@"; do
  if [ "$arg" == "--stop-docker" ]; then
    AUTO_STOP_DOCKER=true
  fi
done

cleanup() {
  if [ "$STARTED_DOCKER" = true ] || [ "$AUTO_STOP_DOCKER" = true ]; then
    echo "🔌 Post-verification cleanup: stopping Docker containers..."
    ./stop-docker.sh || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting Full-Stack Local Quality Verification..."

# 1. Format and check Frontend
echo "Checking Frontend code formatting..."
if ! (cd frontend && npx prettier --check .); then
  echo -e "${RED}Frontend formatting checks failed! Running formatter...${NC}"
  (cd frontend && npx prettier --write .)
fi

# 2. Run Frontend Tests
echo "Running Frontend unit tests..."
if ! (cd frontend && npm test); then
  echo -e "${RED}Frontend unit tests failed!${NC}"
  exit 1
fi

# 3. Run Backend Tests
echo "Running Spring Boot backend verification and tests..."
if ! ./gradlew check test; then
  echo -e "${RED}Backend build or tests failed!${NC}"
  exit 1
fi

# 4. Run E2E Tests through the public Nginx ingress.
echo "Running Playwright E2E tests..."
if ! curl -fs --max-time 3 http://localhost:4200/api/v1/catalog > /dev/null 2>&1; then
  echo "Backend is not running — starting full application stack via ./start-docker.sh..."
  ./start-docker.sh
  STARTED_DOCKER=true
fi

echo "Waiting for the Nginx API ingress to become ready..."
for attempt in {1..30}; do
  if curl -fs --max-time 3 http://localhost:4200/api/v1/catalog > /dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo -e "${RED}Nginx API ingress did not become ready!${NC}"
    exit 1
  fi
  sleep 1
done

# The strict Nginx CSP (`script-src 'self'`) blocks inline event handlers.
# Angular's inlineCritical optimization serves the stylesheet as
# `media="print" onload="this.media='all'"`, so that CSP leaves the page
# unstyled. Fail fast if the served bundle shipped that pattern.
if ! INDEX_HTML="$(curl -fs --max-time 5 http://localhost:4200/ 2>/dev/null)"; then
  echo -e "${RED}Could not fetch http://localhost:4200/ to verify the served bundle!${NC}"
  exit 1
fi

if printf '%s' "$INDEX_HTML" | grep -qE 'media="print"[^>]*onload='; then
  echo -e "${RED}Built index.html uses the CSP-blocked inline onload async-CSS trick (keep optimization.styles.inlineCritical=false)!${NC}"
  exit 1
fi

# Only the production image serves a hashed bundle. If a dev server (npm start)
# already occupies :4200, the Docker stack is skipped above and this check
# cannot exercise the strict-CSP path — report that instead of passing silently.
if ! printf '%s' "$INDEX_HTML" | grep -qE 'main-[A-Za-z0-9_-]+\.js'; then
  echo -e "${YELLOW}Warning: http://localhost:4200/ is not serving a hashed production bundle (dev server?), so the production CSP/CSS check was skipped. Stop 'npm start' and re-run to verify the Docker image.${NC}"
else
  # The production Angular build emits an inline SRI import map. Nginx must
  # authorize its exact bytes with the sha384 source expression generated in
  # the frontend Dockerfile; without it the import map is blocked and the SRI
  # metadata for every lazy chunk is silently discarded.
  IMPORT_MAP_COUNT="$(printf '%s' "$INDEX_HTML" | grep -o '<script type="importmap">[^<]*</script>' | wc -l | tr -d ' ' || true)"
  if [ "$IMPORT_MAP_COUNT" -ne 1 ]; then
    echo -e "${RED}Expected exactly one inline import map in the served index.html, found ${IMPORT_MAP_COUNT}!${NC}"
    exit 1
  fi
  IMPORT_MAP_JSON="$(printf '%s' "$INDEX_HTML" | grep -o '<script type="importmap">[^<]*</script>' | sed -e 's#^<script type="importmap">##' -e 's#</script>$##' || true)"
  IMPORT_MAP_HASH="$(printf '%s' "$IMPORT_MAP_JSON" | openssl dgst -sha384 -binary | openssl base64 -A)"
  CSP_HEADER="$(curl -fsSI --max-time 5 http://localhost:4200/ | tr -d '\r' | grep -i '^content-security-policy:' || true)"
  if ! printf '%s' "$CSP_HEADER" | grep -q "sha384-${IMPORT_MAP_HASH}"; then
    echo -e "${RED}Served Content-Security-Policy does not authorize the inline import map (missing sha384-${IMPORT_MAP_HASH})!${NC}"
    exit 1
  fi
fi

if ! (cd frontend && E2E_DOCKER=true npm run e2e); then
  echo -e "${RED}E2E tests failed!${NC}"
  exit 1
fi

echo -e "${GREEN}All checks passed successfully! Safe to commit & push.${NC}"
