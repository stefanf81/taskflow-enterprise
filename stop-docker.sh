#!/bin/bash

# =========================================================================================
# BarberFlow Docker Compose Teardown Script
# Safely spins down the container orchestration, cleans up networks, and preserves volumes.
# =========================================================================================

# Automatically move to the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "🛑 Stopping BarberFlow Full-Stack App"
echo "=========================================="

# Check for Docker daemon to prevent confusing Compose errors
if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker daemon is not running. Please start Docker."
    exit 1
fi

echo "🔌 Shutting down containers and removing temporary networks..."
# Brings down the containers and the frontend-tier/backend-tier networks.
# Note: Named volumes (pgdata, redisdata) are inherently preserved by default.
docker compose down

echo "✅ App stopped successfully!"
