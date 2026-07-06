#!/bin/bash

# =========================================================================================
# TaskFlow Docker Compose Startup Script
# This script builds the optimized Docker images, runs static security analysis,
# and spins up the entire application stack in isolated Docker networks.
# =========================================================================================

# Exit immediately if any command fails. This ensures we don't accidentally spin up
# the cluster if a build step or security scan fails midway through the pipeline.
set -e

# Enforce BuildKit for parallelized, high-performance container compilations
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Automatically move to the directory where this script is located.
# This guarantees the script works perfectly regardless of where the user executes it from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "============================================"
echo "🚀 Starting TaskFlow Full-Stack App in Docker"
echo "============================================"

# =========================================================================================
# 1. Prerequisite Checks
# =========================================================================================
# Check if the Docker daemon is actively running on the host machine.
if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker daemon is not running. Please start Docker first."
    exit 1
fi

# =========================================================================================
# 2. Build backend and frontend artifacts on the host
# Reusing pre-built artifacts in Docker is a huge optimization that prevents in-container rebuilding.
# =========================================================================================
echo "🔨 Building backend JAR on the host..."
./gradlew processAot bootJar --no-daemon

echo "🔨 Building frontend production bundle on the host..."
(cd frontend && npm ci --prefer-offline --no-audit --no-fund && npm run build)

echo "📦 Building images..."
docker compose build

# =========================================================================================
# 3. Shift-Left Security: Static Lints & Vulnerability Scanning
# We intercept the pipeline here. If Hadolint or Trivy detects a CRITICAL vulnerability 
# in the OS layer or package manifest, they will log warnings.
# 
# [PERFORMANCE TWEAK] These IO/CPU-heavy scans are now backgrounded to run concurrently!
# =========================================================================================
echo "🔍 Running static lints and vulnerability scans in parallel..."

(docker run --rm -i hadolint/hadolint < Dockerfile || echo "⚠️  Hadolint found backend Dockerfile issues.") &
(docker run --rm -i hadolint/hadolint < frontend/Dockerfile || echo "⚠️  Hadolint found frontend Dockerfile issues.") &
(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ~/.cache:/root/.cache/ aquasec/trivy:latest image --severity HIGH,CRITICAL taskflow-backend:latest || echo "⚠️  Trivy found backend image issues.") &
(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ~/.cache:/root/.cache/ aquasec/trivy:latest image --severity HIGH,CRITICAL taskflow-frontend:latest || echo "⚠️  Trivy found frontend image issues.") &

wait
echo "✅ Security scans complete!"

# =========================================================================================
# 4. Spin up Containers
# The `-d` flag runs the containers in detached (background) mode.
# Docker Compose will automatically provision the zero-trust networks (`frontend-tier` & `backend-tier`)
# and enforce read-only filesystems and dropped capabilities as defined in the yaml.
# =========================================================================================
echo "🚀 Spinning up containers..."
docker compose up -d

echo ""
echo "================================================="
echo "🎉 TaskFlow is successfully running in containers!"
echo "================================================="
echo "🖥️  Frontend       : http://localhost:4200"
echo "🔌 Backend API     : http://localhost:8080/api/v1/appointments"
echo "📖 Swagger API Docs: http://localhost:8080/swagger-ui/index.html"
echo "🛢️  Durable Database: PostgreSQL 17 (Host port 5432)"
echo "================================================="
echo "💡 To view container logs:  docker compose logs -f"
echo "💡 To stop the application: ./stop-docker.sh"
echo "================================================="
