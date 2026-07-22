#!/usr/bin/env bash
set -euo pipefail

# Color Codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

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

# 4. Run E2E Tests (requires a running backend on :8080 and Playwright browsers)
echo "Running Playwright E2E tests..."
if curl -fs --max-time 3 http://localhost:8080/actuator/health/liveness > /dev/null 2>&1; then
  if ! (cd frontend && npm run e2e); then
    echo -e "${RED}E2E tests failed!${NC}"
    exit 1
  fi
else
  echo -e "${RED}Backend is not running on http://localhost:8080 — start it first (e.g. ./gradlew bootRun)${NC}"
  exit 1
fi

echo -e "${GREEN}All checks passed successfully! Safe to commit & push.${NC}"
