#!/usr/bin/env bash
set -euo pipefail

# Ensure we are working from the directory where this script is located
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" &> /dev/null && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Building and starting Jenkins (DinD) in high-performance mode..."
docker compose up -d --build

echo "========================================================================="
echo "✅ Jenkins is starting up successfully!"
echo "👉 Access the Jenkins console at: http://localhost:8081"
echo "========================================================================="
