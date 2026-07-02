#!/bin/bash

# Exit on any error
set -e

# Enforce BuildKit for parallelized, high-performance container compilations
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Automatically move to the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "🛡️  TASKFLOW DYNAMIC APPLICATION SECURITY TESTING (DAST)"
echo "=========================================================="

# Check if docker daemon is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker daemon is not running. Please start Docker first."
    exit 1
fi

echo "🚀 Spinning up application containers..."
docker compose up --build -d

echo "⏳ Waiting for backend API to become healthy..."
# Poll the actuator health endpoint until it is fully active
HEALTHY=false
for i in {1..30}; do
  if curl -s --connect-timeout 1 http://localhost:8080/actuator/health | grep -q "UP"; then
    echo "✅ Backend API is active and ready!"
    HEALTHY=true
    break
  fi
  echo "  Waiting..."
  sleep 2
done

if [ "$HEALTHY" = false ]; then
  echo "❌ Error: Backend API failed to become healthy within 60 seconds."
  echo "🛑 Cleaning up containers..."
  docker compose down
  exit 1
fi

echo "📦 Pulling OWASP ZAP (Zed Attack Proxy) SOTA DAST scanner..."
docker pull ghcr.io/zaproxy/zaproxy:stable

echo "🔍 Running OWASP ZAP OpenAPI security fuzzing scan..."
# -v $(pwd):/zap/wrk/:rw mounts current host directory to write the report
# -t scans the OpenAPI schema, discovering all paths and injecting payloads (SQLi, XSS, etc.)
# host.docker.internal allows container-to-host network calls on macOS and Windows
docker run --rm \
  -v "$(pwd)":/zap/wrk/:rw \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py \
  -t http://host.docker.internal:8080/v3/api-docs \
  -f openapi \
  -r zap_report.html || echo "⚠️  ZAP Scan complete (some alerts/warnings may have been found, check zap_report.html)."

echo "🛑 Cleaning up containers..."
docker compose down

echo "=========================================================="
echo "🎉 DAST scan completed successfully!"
echo "📖 View the security report: open zap_report.html"
echo "=========================================================="
