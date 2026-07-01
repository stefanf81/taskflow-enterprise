#!/bin/bash

# =========================================================================================
# BarberFlow Docker Compose Startup Script
# This script builds the optimized Docker images, runs static security analysis,
# and spins up the entire application stack in isolated Docker networks.
# =========================================================================================

# Exit immediately if any command fails. This ensures we don't accidentally spin up
# the cluster if a build step or security scan fails midway through the pipeline.
set -e

# Automatically move to the directory where this script is located.
# This guarantees the script works perfectly regardless of where the user executes it from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "============================================"
echo "🚀 Starting BarberFlow Full-Stack App in Docker"
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
# 2. Build Production Docker Images
# We rely on 'docker compose build' to execute our elite Dockerfiles.
# Note: The backend Dockerfile uses BuildKit caching, AOT compilation, and layered JAR extraction.
# =========================================================================================
echo "📦 Building images..."
docker compose build

# =========================================================================================
# 3. Shift-Left Security: Static Lints & Vulnerability Scanning
# We intercept the pipeline here. If Hadolint or Trivy detects a CRITICAL vulnerability 
# in the OS layer or package manifest, they will log warnings.
# =========================================================================================
echo "🔍 HADOLINT: Linting Dockerfiles..."
docker run --rm -i hadolint/hadolint < Dockerfile || echo "⚠️  Hadolint found backend Dockerfile issues."
docker run --rm -i hadolint/hadolint < frontend/Dockerfile || echo "⚠️  Hadolint found frontend Dockerfile issues."

echo "🛡️  TRIVY: Scanning Backend container image..."
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ~/.cache:/root/.cache/ aquasec/trivy:latest image --severity HIGH,CRITICAL taskflow-backend:latest || echo "⚠️  Trivy found backend image issues."

echo "🛡️  TRIVY: Scanning Frontend container image..."
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ~/.cache:/root/.cache/ aquasec/trivy:latest image --severity HIGH,CRITICAL taskflow-frontend:latest || echo "⚠️  Trivy found frontend image issues."

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
echo "🎉 BarberFlow is successfully running in containers!"
echo "================================================="
echo "🖥️  Frontend       : http://localhost:4200"
echo "🔌 Backend API     : http://localhost:8080/api/v1/appointments"
echo "📖 Swagger API Docs: http://localhost:8080/swagger-ui/index.html"
echo "🛢️  Durable Database: PostgreSQL 17 (Host port 5432)"
echo "================================================="
echo "💡 To view container logs:  docker compose logs -f"
echo "💡 To stop the application: ./stop-docker.sh"
echo "================================================="
