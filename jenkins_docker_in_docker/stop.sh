#!/usr/bin/env bash
set -euo pipefail

# Ensure we are working from the directory where this script is located
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" &> /dev/null && pwd)"
cd "$SCRIPT_DIR"

echo "🛑 Shutting down Jenkins (DinD) stack..."
docker compose down

echo "========================================================================="
echo "✅ Jenkins stack stopped successfully."
echo "========================================================================="
