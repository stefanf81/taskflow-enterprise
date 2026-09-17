#!/usr/bin/env bash
# Container-level benchmark for glibc allocator/huge-page tuning on the
# Ubuntu-based Temurin image (BENCHMARKS.md §51).
#
# Runs the production-like compose stack (db, redis, backend, frontend) with a
# single tuning variant, drives load through the Nginx ingress with `hey`, and
# prints one summary line with throughput, latency, RSS, GC pauses, and startup.
#
# Usage:
#   IMAGE=taskflow-backend:latest LABEL=ubuntu-default scripts/benchmark-glibc-tuning.sh
#   IMAGE=taskflow-backend:latest LABEL=ubuntu-arena2 ARENA_MAX=2 scripts/benchmark-glibc-tuning.sh
#   IMAGE=taskflow-backend:latest LABEL=ubuntu-thp THP=1 scripts/benchmark-glibc-tuning.sh
#   IMAGE=taskflow-backend:latest LABEL=ubuntu-jemalloc JEMALLOC=1 scripts/benchmark-glibc-tuning.sh
#
# ARENA_MAX unset inherits docker-compose.yml (MALLOC_ARENA_MAX=2 since §51);
# pass ARENA_MAX=8 to approximate the pre-adoption glibc cap. JEMALLOC=1 needs
# libjemalloc2 in the image (evaluated and rejected in §51, not shipped).
#
# Env: IMAGE, LABEL (required); ARENA_MAX, JEMALLOC, THP, ENDPOINT, DURATION,
#      CONCURRENCY, WARMUP_SECONDS (optional).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${IMAGE:?IMAGE is required (e.g. taskflow-backend:latest)}"
: "${LABEL:?LABEL is required (e.g. ubuntu-default)}"
ARENA_MAX="${ARENA_MAX:-}"
JEMALLOC="${JEMALLOC:-0}"
THP="${THP:-0}"
ENDPOINT="${ENDPOINT:-http://localhost:4200/api/v1/barbers}"
DURATION="${DURATION:-30s}"
CONCURRENCY="${CONCURRENCY:-50}"
WARMUP_SECONDS="${WARMUP_SECONDS:-5}"
OVERRIDE="$(mktemp -t compose-glibc-bench.XXXXXX.yml)"
OUT_DIR="${OUT_DIR:-$(mktemp -d -t glibc-bench.XXXXXX)}"
mkdir -p "$OUT_DIR"

command -v hey >/dev/null || { echo "hey is required (brew install hey)" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
[ -f .env ] || { echo ".env is required (copy .env.example)" >&2; exit 1; }

cleanup() {
  docker compose -f docker-compose.yml -f "$OVERRIDE" down --remove-orphans >/dev/null 2>&1 || true
  rm -f "$OVERRIDE"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Resolve variant settings against the image itself.
# ---------------------------------------------------------------------------
JEMALLOC_LIB=""
if [ "$JEMALLOC" = "1" ]; then
  JEMALLOC_LIB="$(docker run --rm --entrypoint sh "$IMAGE" -c \
    'ldconfig -p | awk "/libjemalloc\\.so\\.2/ {print \$NF; exit}"')"
  [ -n "$JEMALLOC_LIB" ] || { echo "$IMAGE has no libjemalloc.so.2 (rebuild with libjemalloc2)" >&2; exit 1; }
fi

BASE_JAVA_OPTS="$(docker compose -f docker-compose.yml config --format json \
  | jq -r '.services.backend.environment.JAVA_TOOL_OPTIONS')"
EXTRA_JAVA_OPTS=""
[ "$THP" = "1" ] && EXTRA_JAVA_OPTS=" -XX:+UseTransparentHugePages"

{
  echo "services:"
  echo "  backend:"
  echo "    image: ${IMAGE}"
  echo "    environment:"
  # Keep the rate limiter in the hot path (Redis Lua EVAL) but non-blocking:
  # the default prod bucket (100/min) would 429 the entire load run.
  echo "      - APP_RATE_LIMIT_MAX_REQUESTS_PER_MINUTE=100000000"
  [ -n "$ARENA_MAX" ] && echo "      - MALLOC_ARENA_MAX=${ARENA_MAX}"
  [ -n "$JEMALLOC_LIB" ] && echo "      - LD_PRELOAD=${JEMALLOC_LIB}"
  if [ -n "$EXTRA_JAVA_OPTS" ]; then
    echo "      - JAVA_TOOL_OPTIONS=${BASE_JAVA_OPTS}${EXTRA_JAVA_OPTS}"
  fi
} > "$OVERRIDE"

echo "==> [${LABEL}] image=${IMAGE} arena=${ARENA_MAX:-default} jemalloc=${JEMALLOC} thp=${THP}"

docker compose -f docker-compose.yml -f "$OVERRIDE" down --remove-orphans >/dev/null 2>&1 || true
docker compose -f docker-compose.yml -f "$OVERRIDE" up -d db redis backend frontend >/dev/null

for _ in $(seq 1 60); do
  status="$(docker inspect taskflow-backend --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  [ "$status" = "unhealthy" ] && { docker logs taskflow-backend >&2; exit 1; }
  sleep 2
done
[ "$(docker inspect taskflow-backend --format '{{.State.Health.Status}}')" = "healthy" ] \
  || { echo "backend never became healthy" >&2; exit 1; }

# Capture startup before load: compose's json-file rotation (10m x3) can push
# the "Started TaskflowApplication" line out once request logging kicks in.
docker logs taskflow-backend > "$OUT_DIR/${LABEL}-app.log" 2>&1 || true
STARTUP="$(awk '/Started TaskflowApplication in/ {for (i=1;i<=NF;i++) if ($i=="in") print $(i+1)}' \
  "$OUT_DIR/${LABEL}-app.log" | tail -1)"

# Warm JIT and connection pools before measuring.
hey -z "${WARMUP_SECONDS}s" -c 10 "$ENDPOINT" > "$OUT_DIR/${LABEL}-warmup.txt" 2>&1 || true
sleep 3

hey -z "$DURATION" -c "$CONCURRENCY" "$ENDPOINT" > "$OUT_DIR/${LABEL}-load.txt" 2>&1

RPS="$(awk '/Requests\/sec:/ {print $2}' "$OUT_DIR/${LABEL}-load.txt")"
P50="$(awk '/^[[:space:]]+50%/ {print $3}' "$OUT_DIR/${LABEL}-load.txt")"
P95="$(awk '/^[[:space:]]+95%/ {print $3}' "$OUT_DIR/${LABEL}-load.txt")"
P99="$(awk '/^[[:space:]]+99%/ {print $3}' "$OUT_DIR/${LABEL}-load.txt")"
OK2XX="$(sed -nE 's/^[[:space:]]*\[([0-9]{3})\][[:space:]]+([0-9]+).*/\1 \2/p' "$OUT_DIR/${LABEL}-load.txt" \
  | awk '$1 >= 200 && $1 < 300 {n+=$2} END {print n+0}')"
NON2XX="$(sed -nE 's/^[[:space:]]*\[([0-9]{3})\][[:space:]]+([0-9]+).*/\1 \2/p' "$OUT_DIR/${LABEL}-load.txt" \
  | awk '$1 < 200 || $1 >= 300 {n+=$2} END {print n+0}')"

RSS="$(docker stats --no-stream --format '{{.MemUsage}}' taskflow-backend | awk -F' / ' '{print $1}')"
docker logs --tail 2000 taskflow-backend > "$OUT_DIR/${LABEL}-tail.log" 2>&1 || true

# Confirm the tuning variant actually reached the running JVM process.
JAVA_PID="$(docker exec taskflow-backend sh -c 'for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = "java" ] && { echo ${p#/proc/}; break; }; done' 2>/dev/null || true)"
ARENA_APPLIED="n/a"
JEMALLOC_MAPS="0"
THP_KB="n/a"
if [ -n "$JAVA_PID" ]; then
  ARENA_APPLIED="$(docker exec taskflow-backend sh -c \
    "tr '\\0' '\\n' < /proc/${JAVA_PID}/environ | sed -n 's/^MALLOC_ARENA_MAX=//p'" 2>/dev/null || true)"
  JEMALLOC_MAPS="$(docker exec taskflow-backend sh -c \
    "grep -c libjemalloc /proc/${JAVA_PID}/maps" 2>/dev/null || echo 0)"
  THP_KB="$(docker exec taskflow-backend sh -c \
    "awk '/AnonHugePages/ {s+=\$2} END {print s+0}' /proc/${JAVA_PID}/smaps" 2>/dev/null || echo n/a)"
fi

docker exec taskflow-backend sh -c 'cat /tmp/gc.log' > "$OUT_DIR/${LABEL}-gc.log" 2>/dev/null || true
GC_STATS="$(awk '/Pause/ {gsub(/ms$/, "", $NF); print $NF}' "$OUT_DIR/${LABEL}-gc.log" \
  | sort -n | awk '{a[NR]=$1} END {
      if (NR == 0) { print "n/a n/a"; exit }
      s=0; for (i=1;i<=NR;i++) s+=a[i];
      printf "n=%d avg=%.2f p99=%.2f", NR, s/NR, a[int(NR*0.99)==0?1:int(NR*0.99)] }')"
GC_COUNT="$(echo "$GC_STATS" | sed -n 's/^n=\([0-9]*\).*/\1/p')"
GC_AVG="$(echo "$GC_STATS" | sed -n 's/.*avg=\([0-9.]*\).*/\1/p')"
GC_P99="$(echo "$GC_STATS" | sed -n 's/.*p99=\([0-9.]*\).*/\1/p')"

printf 'RESULT | %-16s | RPS=%-8s | p50=%-7s | p95=%-7s | p99=%-7s | ok2xx=%-8s | non2xx=%-4s | rss=%-10s | gc_n=%-4s | gc_avg_ms=%-7s | gc_p99_ms=%-7s | startup_s=%-6s | arena_env=%-4s | jemalloc_maps=%-3s | thp_mb=%s\n' \
  "$LABEL" "${RPS:-n/a}" "${P50:-n/a}" "${P95:-n/a}" "${P99:-n/a}" "${OK2XX:-0}" "$NON2XX" "${RSS:-n/a}" \
  "${GC_COUNT:-n/a}" "${GC_AVG:-n/a}" "${GC_P99:-n/a}" "${STARTUP:-n/a}" "${ARENA_APPLIED:-n/a}" \
  "${JEMALLOC_MAPS:-0}" "$( [ "$THP_KB" = "n/a" ] && echo n/a || echo $((THP_KB / 1024)) )"

[ "${OK2XX:-0}" -gt 0 ] || { echo "ERROR: no 2xx responses — benchmark measured an error path" >&2; exit 1; }
[ "$NON2XX" -eq 0 ] || echo "WARNING: ${NON2XX} non-2xx responses during load" >&2

echo "==> raw output: $OUT_DIR"
