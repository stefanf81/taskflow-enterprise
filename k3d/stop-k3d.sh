#!/bin/bash

# =========================================================================================
# TaskFlow K3d Teardown Script
# Safely destroys the local Kubernetes cluster and removes all isolated configuration files.
# =========================================================================================

# Automatically move to the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
# This script lives in ./k3d but operates from the repository root
# (where the generated k3d-kubeconfig.yaml is written).
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

echo "=========================================================="
echo "🛑 STOPPING TASKFLOW KUBERNETES CLUSTER ON K3D"
echo "=========================================================="

# Check if k3d is available before attempting to interact with it
if ! command -v k3d &> /dev/null; then
    echo "❌ Error: k3d is not installed."
    exit 1
fi

# Detect if the specific taskflow cluster exists, then gracefully destroy it
if k3d cluster list | grep -q "taskflow-cluster"; then
    echo "🔌 Deleting k3d Kubernetes cluster 'taskflow-cluster'..."
    k3d cluster delete taskflow-cluster
    echo "✅ Cluster deleted successfully!"
else
    echo "ℹ️  No active 'taskflow-cluster' found."
fi

# Clean up the isolated SOTA kubeconfig file to prevent credential leaks or future CLI confusion
if [ -f k3d-kubeconfig.yaml ]; then
    echo "🧹 Removing isolated kubeconfig file..."
    rm -f k3d-kubeconfig.yaml
fi

echo "=========================================================="
echo "🎉 Cleanup completed successfully!"
echo "=========================================================="
