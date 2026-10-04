#!/usr/bin/env bash
# Cold-start benchmark for the backend CDS archive (BENCHMARKS.md §56).
#
# Boots each image RUNS times with the prod profile against throwaway
# PostgreSQL and Redis containers (the docker-compose.yml images), interleaving
# the variants so host drift hits all of them equally. Prints the median Spring
# Boot "process running for" time and the share of loaded classes served from
# the CDS archive (measured in one extra boot per variant, so the class-load
# log does not skew the timed runs).
#
# Usage:
#   docker build -f Dockerfile.x64 -t taskflow-backend:after .
#   IMAGES="taskflow-backend:before taskflow-backend:after" NOCDS=1 \
#     scripts/benchmark-cds-startup.sh
#
# NOCDS=1 adds the first image with -Xshare:off as the no-archive reference.
# That flag must replace the image CMD: JAVA_TOOL_OPTIONS is prepended, so the
# CMD's -Xshare:auto would win. JAVA_TOOL_OPTIONS is taken verbatim from the
# docker-compose.yml backend.
#
# Env: IMAGES (required); RUNS, NOCDS, CPUS, MEMORY (optional).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${IMAGES:?IMAGES is required (space-separated image tags)}"
RUNS="${RUNS:-6}"
NOCDS="${NOCDS:-0}"
CPUS="${CPUS:-2}"
MEMORY="${MEMORY:-2g}"
PG_IMAGE="$(sed -n 's/^ *image: *\(postgres:[^ ]*\).*/\1/p' docker-compose.yml | head -1)"
REDIS_IMAGE="$(sed -n 's/^ *image: *\(redis:[^ ]*\).*/\1/p' docker-compose.yml | head -1)"
JAVA_OPTS="$(sed -n 's/^ *- JAVA_TOOL_OPTIONS=//p' docker-compose.yml | head -1)"
NET="cds-bench-$$"
WORK="$(mktemp -d -t cds-bench.XXXXXX)"

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }
[ -n "$PG_IMAGE" ] && [ -n "$REDIS_IMAGE" ] && [ -n "$JAVA_OPTS" ] \
  || { echo "could not read images/JAVA_TOOL_OPTIONS from docker-compose.yml" >&2; exit 1; }

cleanup() {
  docker rm -f cds-bench-app cds-bench-db cds-bench-redis >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# The prod profile refuses to start without a persistent JWT key pair.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$WORK/key.pem" 2>/dev/null
PRIVATE_KEY="$(openssl pkcs8 -topk8 -nocrypt -in "$WORK/key.pem" -outform DER | base64 | tr -d '\n')"
PUBLIC_KEY="$(openssl pkey -in "$WORK/key.pem" -pubout -outform DER | base64 | tr -d '\n')"

docker network create "$NET" >/dev/null
docker run -d --name cds-bench-db --network "$NET" --network-alias db \
  -e POSTGRES_DB=taskflow -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=cds-bench \
  "$PG_IMAGE" >/dev/null
docker run -d --name cds-bench-redis --network "$NET" --network-alias redis \
  "$REDIS_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec cds-bench-db pg_isready -U postgres -d taskflow >/dev/null 2>&1 && break
  sleep 1
done

# boot IMAGE EXTRA_JAVA_OPTS [CMD_ARGS...] -> prints the "process running for"
# seconds. Runs with the same hardening as production (read-only root, tmpfs).
boot() {
  local image="$1" extra="$2"
  shift 2
  docker rm -f cds-bench-app >/dev/null 2>&1 || true
  docker run -d --name cds-bench-app --network "$NET" --cpus "$CPUS" --memory "$MEMORY" \
    --read-only --tmpfs /tmp:uid=10001,gid=10001 \
    --cap-drop ALL --security-opt no-new-privileges:true \
    -e SPRING_PROFILES_ACTIVE=prod \
    -e SPRING_DATASOURCE_PASSWORD=cds-bench \
    -e SPRING_SECURITY_PASSWORD=cds-bench-password \
    -e APP_RSA_PRIVATE_KEY="$PRIVATE_KEY" -e APP_RSA_PUBLIC_KEY="$PUBLIC_KEY" \
    -e MALLOC_ARENA_MAX=2 \
    -e JAVA_TOOL_OPTIONS="$JAVA_OPTS $extra" \
    "$image" "$@" >/dev/null
  # No grep -q: an early exit would SIGPIPE docker logs and fail the pipeline.
  for _ in $(seq 1 240); do
    docker logs cds-bench-app 2>&1 \
      | grep -E 'Started TaskflowApplication|APPLICATION FAILED' >/dev/null && break
    sleep 0.5
  done
  local seconds
  seconds="$(docker logs cds-bench-app 2>&1 \
    | sed -nE 's/.*process running for ([0-9.]+).*/\1/p' | tail -1)"
  [ -n "$seconds" ] || { docker logs cds-bench-app >&2; echo "$image failed to start" >&2; exit 1; }
  echo "$seconds"
}

# Variants: "label|image|CMD override" (empty keeps the image CMD).
NOCDS_CMD="-XX:+ExitOnOutOfMemoryError -Xshare:off -jar application.jar"
VARIANTS=()
read -r -a IMAGE_LIST <<< "$IMAGES"
[ "$NOCDS" = "1" ] && VARIANTS+=("${IMAGE_LIST[0]} -Xshare:off|${IMAGE_LIST[0]}|$NOCDS_CMD")
for image in "${IMAGE_LIST[@]}"; do VARIANTS+=("$image|$image|"); done

echo "==> applying Flyway migrations (untimed boot of ${IMAGE_LIST[0]})"
boot "${IMAGE_LIST[0]}" "" >/dev/null

for run in $(seq 1 "$RUNS"); do
  for variant in "${VARIANTS[@]}"; do
    IFS='|' read -r label image cmd <<< "$variant"
    read -r -a cmd_args <<< "$cmd"
    seconds="$(boot "$image" "" ${cmd_args[@]+"${cmd_args[@]}"})"
    echo "run ${run}: ${label} ${seconds}s"
    echo "$seconds" >> "$WORK/$(echo "$label" | tr -c 'A-Za-z0-9' '_')"
  done
done

for variant in "${VARIANTS[@]}"; do
  IFS='|' read -r label image cmd <<< "$variant"
  read -r -a cmd_args <<< "$cmd"
  boot "$image" "-Xlog:class+load=info:file=/tmp/class-load.log" ${cmd_args[@]+"${cmd_args[@]}"} >/dev/null
  total="$(docker exec cds-bench-app grep -c 'source:' /tmp/class-load.log || true)"
  shared="$(docker exec cds-bench-app grep -c 'source: shared objects file' /tmp/class-load.log || true)"
  sort -n "$WORK/$(echo "$label" | tr -c 'A-Za-z0-9' '_')" | awk -v label="$label" \
    -v total="${total:-0}" -v shared="${shared:-0}" '
      { a[NR] = $1 }
      END {
        median = (NR % 2) ? a[(NR + 1) / 2] : (a[NR / 2] + a[NR / 2 + 1]) / 2
        printf "RESULT | %-40s | median=%.2fs | min=%.2fs | max=%.2fs | cds_classes=%d/%d (%.0f%%)\n",
          label, median, a[1], a[NR], shared, total, total ? 100 * shared / total : 0
      }'
done
