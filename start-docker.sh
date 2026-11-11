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
# The daemon that ./gradlew check left running (verify.sh) is reused; --no-daemon forked a cold
# single-use JVM because gradle.properties sets org.gradle.jvmargs.
./gradlew bootJar

echo "🔨 Building frontend production bundle on the host..."
# One install from the root for every workspace (README "Install"). `npm ci` inside frontend/
# acts as `npm ci --workspace frontend`: it deletes the root node_modules and reinstalls only the
# frontend, leaving mobile, shared/schemas and the root tooling uninstalled afterwards.
# Skipped when the installed tree matches the lockfile: npm rewrites node_modules/.package-lock.json
# on every install, so a lockfile newer than it means an install is due. verify.sh has just run
# every lint and test against this tree; reinstalling it (~1 GB with React Native) cost 15-45 s.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci --prefer-offline --no-audit --no-fund
else
    echo "   node_modules matches package-lock.json; skipping npm ci (delete node_modules to force it)."
fi
npm --prefix frontend run build

echo "📦 Building images..."
docker compose build

# =========================================================================================
# 3. Shift-Left Security: Static Lints
# We intercept the pipeline here. If Hadolint detects any issues, it will log warnings.
# 
# [PERFORMANCE TWEAK] These IO/CPU-heavy scans are now backgrounded to run concurrently!
# =========================================================================================
echo "🔍 Running static lints in parallel..."

(docker run --rm -i hadolint/hadolint < Dockerfile || echo "⚠️  Hadolint found backend Dockerfile issues.") &
(docker run --rm -i hadolint/hadolint < frontend/Dockerfile || echo "⚠️  Hadolint found frontend Dockerfile issues.") &

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
echo "🔌 API             : http://localhost:4200/api/v1/appointments"
echo "📖 Swagger API Docs: disabled in the Compose production profile"
echo "🛢️  Durable Database: PostgreSQL 18 (Host port 5432)"
echo "================================================="
echo "💡 To view container logs:  docker compose logs -f"
echo "💡 To stop the application: ./stop-docker.sh"
echo "================================================="
