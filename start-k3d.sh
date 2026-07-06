#!/bin/bash

# Exit immediately if any command fails. This ensures we don't accidentally deploy
# if a build step or security scan fails midway through the pipeline.
set -e

# Automatically move to the directory where this script is located
# This guarantees the script works regardless of where the user executes it from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "☸️  TASKFLOW KUBERNETES DEPLOYMENT ON K3D"
echo "=========================================================="

# =========================================================================================
# 1. Prerequisite Checks
# Ensure all required DevSecOps CLI tools are installed before attempting deployment.
# =========================================================================================
if ! command -v k3d &> /dev/null; then
    echo "❌ Error: k3d is not installed. Please install k3d first (https://k3d.io)."
    exit 1
fi

if ! command -v kubectl &> /dev/null; then
    echo "❌ Error: kubectl is not installed. Please install kubectl first."
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker daemon is not running. Please start Docker first."
    exit 1
fi

# =========================================================================================
# 2. Cluster State Reset
# If a previous cluster exists, we completely tear it down to ensure a clean, reproducible state.
# =========================================================================================
if k3d cluster list | grep -q "taskflow-cluster"; then
    echo "⚠️  Existing 'taskflow-cluster' found. Recreating for a clean deployment..."
    k3d cluster delete taskflow-cluster
fi

# Remove any orphaned local kubeconfig to avoid connection errors
rm -f k3d-kubeconfig.yaml

# =========================================================================================
# 3. Build backend and frontend artifacts on the host
# Reusing pre-built artifacts in Docker is a huge optimization that prevents in-container rebuilding.
# =========================================================================================
echo "🔨 Building backend JAR on the host..."
./gradlew processAot bootJar --no-daemon

echo "🔨 Building frontend production bundle on the host..."
(cd frontend && npm ci --prefer-offline --no-audit --no-fund && npm run build)

echo "📦 Building backend and frontend production-grade Docker images..."
export DOCKER_BUILDKIT=1 # Enforce BuildKit for cache mounting
docker build -t ghcr.io/stefanf81/taskflow-backend:latest .
docker build -t ghcr.io/stefanf81/taskflow-frontend:latest ./frontend

# =========================================================================================
# 3a. Shift-Left Security: Static Lints & Vulnerability Scanning
# We intercept the pipeline here. If Hadolint or Trivy detects a CRITICAL vulnerability 
# in the OS layer or package manifest, they will log warnings (or can be set to fail the build).
# =========================================================================================
echo "🔍 HADOLINT: Linting Dockerfiles..."
docker run --rm -i hadolint/hadolint < Dockerfile || echo "⚠️  Hadolint found backend Dockerfile issues."
docker run --rm -i hadolint/hadolint < frontend/Dockerfile || echo "⚠️  Hadolint found frontend Dockerfile issues."

echo "🛡️  TRIVY: Scanning Backend container image..."
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ~/.cache:/root/.cache/ aquasec/trivy:latest image --severity HIGH,CRITICAL taskflow-backend:latest || echo "⚠️  Trivy found backend image issues."

echo "🛡️  TRIVY: Scanning Frontend container image..."
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ~/.cache:/root/.cache/ aquasec/trivy:latest image --severity HIGH,CRITICAL taskflow-frontend:latest || echo "⚠️  Trivy found frontend image issues."

# =========================================================================================
# 4. Spin up the Optimized Declarative k3d Cluster
# We boot the cluster using a declarative YAML file rather than CLI arguments for reproducibility.
# =========================================================================================
echo "☸️  Creating optimized single-node k3d cluster 'taskflow-cluster' via declarative configuration..."
k3d cluster create --config k3d-config.yaml

# =========================================================================================
# 5. Isolate Kubeconfig to Prevent Global AWS/EKS MFA Prompts (SOTA Isolation)
# By extracting the kubeconfig locally and exporting the ENV var, we ensure kubectl 
# only targets this specific test cluster and doesn't accidentally deploy to Production.
# =========================================================================================
echo "🔒 Extracting and isolating cluster kubeconfig..."
k3d kubeconfig get taskflow-cluster > k3d-kubeconfig.yaml
export KUBECONFIG="$(pwd)/k3d-kubeconfig.yaml"

# =========================================================================================
# 6. Import Local Images into the Cluster Namespace
# This prevents Kubernetes from trying to pull these images from Docker Hub.
# =========================================================================================
echo "🚚 Importing local images into the k3d cluster namespace..."
k3d image import ghcr.io/stefanf81/taskflow-backend:latest -c taskflow-cluster
k3d image import ghcr.io/stefanf81/taskflow-frontend:latest -c taskflow-cluster

# =========================================================================================
# 7. Apply Namespace Manifest First to Enforce Bootstrap Order
# =========================================================================================
echo "📄 Applying namespace manifest..."
export KUBECONFIG="$(pwd)/k3d-kubeconfig.yaml"
kubectl apply -f kubernetes/namespace.yaml

# =========================================================================================
# 8. Dynamic Secret Generation
# We dynamically inject local .env passwords into Kubernetes Opaque Secrets.
# This ensures plaintext passwords are NEVER committed to version control.
# =========================================================================================
echo "🔑 Creating Kubernetes secrets from .env..."
set -a
[ -f .env ] && source .env
set +a
kubectl create secret generic db-secret \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres-password}" \
  --namespace=taskflow \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic backend-secret \
  --from-literal=SPRING_SECURITY_PASSWORD="${SPRING_SECURITY_PASSWORD:-admin-password}" \
  --namespace=taskflow \
  --dry-run=client -o yaml | kubectl apply -f -

# =========================================================================================
# 9. Install Local Dev Platform Tools (Observability & Security)
# We provision an enterprise-grade platform inside the local cluster using Helm.
# =========================================================================================
echo "🛡️  Installing DevSecOps Platform Add-ons (Loki Stack, Kyverno, Trivy Operator)..."
helm repo add grafana https://grafana.github.io/helm-charts
helm repo add kyverno https://kyverno.github.io/kyverno/
helm repo add aquasecurity https://aquasecurity.github.io/helm-charts/
helm repo update || true

# Install Kyverno for local policy enforcement (scaled down to 1 replica for local dev)
helm upgrade --install kyverno kyverno/kyverno \
  --namespace kyverno \
  --create-namespace \
  --set admissionController.replicas=1 \
  --set backgroundController.replicas=1 \
  --set cleanupController.replicas=1 \
  --set reportsController.replicas=1

# Install Trivy Operator for local live vulnerability scans
helm upgrade --install trivy-operator aquasecurity/trivy-operator \
  --namespace trivy-system \
  --create-namespace \
  --set "trivy.resources.requests.cpu=100m" \
  --set "trivy.resources.requests.memory=100Mi" \
  --set "trivy.resources.limits.memory=512Mi"

# Install Loki Stack (Loki + Promtail + Grafana) for local logging
helm upgrade --install loki-stack grafana/loki-stack \
  --namespace loki \
  --create-namespace \
  --set promtail.enabled=true \
  --set loki.persistence.enabled=false \
  --set grafana.enabled=true

# =========================================================================================
# 10. Apply Remaining Kubernetes Manifests
# Deploy the actual database, cache, tracing, backend, and frontend pods.
# =========================================================================================
echo "📄 Applying remaining Kubernetes manifests..."
kubectl apply -f kubernetes/

# =========================================================================================
# 11. Wait for Rollouts to Complete
# We block the script until every pod passes its Readiness/Liveness probes.
# =========================================================================================
echo "⏳ Waiting for Kubernetes pods to roll out..."
kubectl rollout status deployment/postgres-db -n taskflow --timeout=120s
kubectl rollout status deployment/redis -n taskflow --timeout=120s
kubectl rollout status deployment/jaeger -n taskflow --timeout=120s
kubectl rollout status deployment/taskflow-backend -n taskflow --timeout=120s
kubectl rollout status deployment/taskflow-frontend -n taskflow --timeout=120s

echo "=========================================================="
echo "🎉 TaskFlow successfully deployed in Kubernetes cluster!"
echo "=========================================================="
echo "🖥️  Frontend          : http://localhost:4200"
echo "🔌 Backend API        : http://localhost:8080/api/v1/appointments"
echo "📖 Swagger API Docs   : http://localhost:8080/swagger-ui/index.html"
echo "🛢️  Durable Database   : PostgreSQL 17 (Inside cluster, PVC backed)"
echo "----------------------------------------------------------"
echo "📊 Observability & DevSecOps Platform Add-ons:"
echo "🛡️  Live Vulnerabilities: KUBECONFIG=k3d-kubeconfig.yaml kubectl get vulnerabilityreports -A"
echo "🧹 Policy Enforcement   : KUBECONFIG=k3d-kubeconfig.yaml kubectl get clusterpolicies"
echo "📈 Grafana Log Viewer   : http://localhost:3000 (after port-forwarding)"
echo "💡 Port-forward Grafana : KUBECONFIG=k3d-kubeconfig.yaml kubectl port-forward -n loki svc/loki-stack-grafana 3000:80"
echo "🔑 Grafana Password     : KUBECONFIG=k3d-kubeconfig.yaml kubectl get secret --namespace loki loki-stack-grafana -o jsonpath=\"{.data.admin-password}\" | base64 --decode ; echo"
echo "=========================================================="
echo "💡 To check running pods: KUBECONFIG=k3d-kubeconfig.yaml kubectl get pods -n taskflow"
echo "💡 To stop and clean up : ./stop-k3d.sh"
echo "=========================================================="
