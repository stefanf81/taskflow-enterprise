#!/usr/bin/env bash
# Throughput / memory / GC comparison of backend images that differ only in the
# JDK (BENCHMARKS.md §86: Java 25 vs a Java 27 runtime vs Java 27 bytecode).
#
# One PostgreSQL and one Redis for the whole run (the docker-compose.yml images);
# every measured run boots a fresh backend container, so each sample starts from
# a cold JVM. Rounds interleave the images and rotate their order, so host drift
# and position effects hit every image equally. The backend gets 2 cores of its
# own (--cpuset-cpus, like production's -XX:ActiveProcessorCount=2) and the
# compose memory limit; PostgreSQL, Redis and the load generator share the
# others, so the client never competes with the JVM under test. `hey` runs in a
# container on the benchmark network (HEY must be a static binary, e.g.
# `CGO_ENABLED=0 go install github.com/rakyll/hey@v0.1.5`): through a published
# port, Docker's userland proxy capped a 2-core backend at ~1,000 req/s.
#
# Per run: boot, log in once through /api/v1/auth/mobile/login (bearer token),
# warm every endpoint, then `hey -z $DURATION -c $CONCURRENCY` on each endpoint
# in turn. Records req/s, p50/p95/p99, process RSS (VmRSS/VmHWM of the java
# process, not `docker stats`), container memory, G1 pause count and total pause
# time from the GC log, and Spring Boot's startup time.
#
# Usage:
#   IMAGES="taskflow-backend:j25 taskflow-backend:j27" ROUNDS=5 \
#     scripts/benchmark-jdk-runtime.sh
#   VARIANTS="j27|taskflow-backend:j27|;j27-jfr|taskflow-backend:j27|-XX:StartFlightRecording" \
#     scripts/benchmark-jdk-runtime.sh
#
# VARIANTS ("label|image|extra JVM options", separated by ";") replaces IMAGES
# when JVM flags must differ: the extra options are appended to the compose
# JAVA_TOOL_OPTIONS, and -XX:+UseZGC replaces its -XX:+UseG1GC.
#
# Env: IMAGES or VARIANTS (one is required); ROUNDS, DURATION, WARMUP, CONCURRENCY, APP_CPUS,
#      SIDE_CPUS, MEMORY, OUT_DIR, HEY (optional).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${IMAGES:=}"
: "${VARIANTS:=}"
[ -n "$IMAGES$VARIANTS" ] || { echo "IMAGES or VARIANTS is required" >&2; exit 1; }
if [ -z "$VARIANTS" ]; then
  for image in $IMAGES; do VARIANTS="${VARIANTS:+$VARIANTS;}${image}|${image}|"; done
fi
ROUNDS="${ROUNDS:-5}"
DURATION="${DURATION:-30s}"
WARMUP="${WARMUP:-10s}"
CONCURRENCY="${CONCURRENCY:-50}"
APP_CPUS="${APP_CPUS:-0,1}"
SIDE_CPUS="${SIDE_CPUS:-2,3}"
MEMORY="${MEMORY:-2560m}"
HEY="${HEY:-hey}"
OUT_DIR="${OUT_DIR:-$(mktemp -d -t jdk-bench.XXXXXX)}"
ENDPOINTS=(/api/v1/catalog /api/v1/barbers /api/v1/auth/me)
mkdir -p "$OUT_DIR"

for tool in "$HEY" jq openssl curl; do
  command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }
done
HEY_BIN="$(command -v "$HEY")"

PG_IMAGE="$(sed -n 's/^ *image: *\(postgres:[^ ]*\).*/\1/p' docker-compose.yml | head -1)"
REDIS_IMAGE="$(sed -n 's/^ *image: *\(redis:[^ ]*\).*/\1/p' docker-compose.yml | head -1)"
JAVA_OPTS="$(sed -n 's/^ *- JAVA_TOOL_OPTIONS=//p' docker-compose.yml | head -1)"
[ -n "$PG_IMAGE" ] && [ -n "$REDIS_IMAGE" ] && [ -n "$JAVA_OPTS" ] \
  || { echo "could not read images/JAVA_TOOL_OPTIONS from docker-compose.yml" >&2; exit 1; }
NET="jdk-bench-$$"
PASSWORD="jdk-bench-password"
PORT=18080

cleanup() {
  docker rm -f jdk-bench-app jdk-bench-db jdk-bench-redis >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$OUT_DIR/key.pem" 2>/dev/null
PRIVATE_KEY="$(openssl pkcs8 -topk8 -nocrypt -in "$OUT_DIR/key.pem" -outform DER | base64 | tr -d '\n')"
PUBLIC_KEY="$(openssl pkey -in "$OUT_DIR/key.pem" -pubout -outform DER | base64 | tr -d '\n')"
rm -f "$OUT_DIR/key.pem"

docker network create "$NET" >/dev/null
docker run -d --name jdk-bench-db --network "$NET" --network-alias db --cpuset-cpus "$SIDE_CPUS" \
  -e POSTGRES_DB=taskflow -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=jdk-bench \
  "$PG_IMAGE" >/dev/null
docker run -d --name jdk-bench-redis --network "$NET" --network-alias redis --cpuset-cpus "$SIDE_CPUS" \
  "$REDIS_IMAGE" redis-server --requirepass jdk-bench >/dev/null
for _ in $(seq 1 60); do
  docker exec jdk-bench-db pg_isready -U postgres -d taskflow >/dev/null 2>&1 && break
  sleep 1
done

# boot IMAGE [EXTRA_OPTS] -> starts the backend and waits for readiness; prints startup seconds.
boot() {
  local image="$1" opts="$JAVA_OPTS ${2:-}"
  case "${2:-}" in *-XX:+UseZGC*) opts="${opts//-XX:+UseG1GC /}" ;; esac
  docker rm -f jdk-bench-app >/dev/null 2>&1 || true
  docker run -d --name jdk-bench-app --network "$NET" --network-alias app -p "127.0.0.1:${PORT}:8080" \
    --cpuset-cpus "$APP_CPUS" --memory "$MEMORY" \
    --read-only --tmpfs /tmp:uid=10001,gid=10001 \
    --tmpfs /var/log/taskflow:uid=10001,gid=10001,mode=0750 \
    --cap-drop ALL --security-opt no-new-privileges:true \
    -e SPRING_PROFILES_ACTIVE=prod \
    -e SPRING_DATASOURCE_PASSWORD=jdk-bench \
    -e REDIS_PASSWORD=jdk-bench \
    -e SPRING_SECURITY_PASSWORD="$PASSWORD" \
    -e APP_CORS_ALLOWED_ORIGINS=http://localhost:4200 \
    -e APP_TRUSTED_PROXY_REGEX='^127\.0\.0\.1$' \
    -e APP_RATE_LIMIT_MAX_REQUESTS_PER_MINUTE=100000000 \
    -e APP_RATE_LIMIT_AUTH_MAX_REQUESTS_PER_MINUTE=100000 \
    -e APP_RSA_PRIVATE_KEY="$PRIVATE_KEY" -e APP_RSA_PUBLIC_KEY="$PUBLIC_KEY" \
    -e MALLOC_ARENA_MAX=2 \
    -e JAVA_TOOL_OPTIONS="$opts" \
    "$image" >/dev/null
  for _ in $(seq 1 240); do
    curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/actuator/health/readiness" 2>/dev/null && break
    docker inspect -f '{{.State.Running}}' jdk-bench-app 2>/dev/null | grep -q true \
      || { docker logs jdk-bench-app >&2; echo "$image exited during startup" >&2; exit 1; }
    sleep 0.5
  done
  docker logs jdk-bench-app 2>&1 | sed -nE 's/.*Started TaskflowApplication in ([0-9.]+) seconds.*/\1/p' | tail -1
}

# load ARGS... -> runs hey on the side cores inside the benchmark network.
load() {
  docker run --rm --network "$NET" --cpuset-cpus "$SIDE_CPUS" -v "$HEY_BIN:/hey:ro" \
    --entrypoint /hey "$REDIS_IMAGE" "$@"
}

java_pid() {
  docker exec jdk-bench-app sh -c \
    'for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = java ] && { echo ${p#/proc/}; break; }; done'
}

IFS=';' read -r -a VARIANT_LIST <<< "$VARIANTS"
n=${#VARIANT_LIST[@]}
IFS='|' read -r _ first_image _ <<< "${VARIANT_LIST[0]}"
echo "==> applying Flyway migrations (untimed boot of ${first_image})"
boot "$first_image" >/dev/null

RESULTS="$OUT_DIR/results.tsv"
printf 'round\timage\tendpoint\trps\tp50_ms\tp95_ms\tp99_ms\tnon2xx\tstartup_s\trss_mib\thwm_mib\tcontainer_mib\tgc_pauses\tgc_pause_total_ms\tjava\n' > "$RESULTS"

for round in $(seq 1 "$ROUNDS"); do
  for k in $(seq 0 $((n - 1))); do
    IFS='|' read -r label image extra <<< "${VARIANT_LIST[$(( (k + round - 1) % n ))]}"
    tag="$(echo "$label" | tr -c 'A-Za-z0-9' '_')"
    startup="$(boot "$image" "$extra")"
    java_version="$(docker logs jdk-bench-app 2>&1 | sed -nE 's/.*Starting TaskflowApplication v[^ ]+ using Java ([0-9.]+).*/\1/p' | head -1)"
    token="$(curl -fsS -H 'Content-Type: application/json' \
      -d "{\"username\":\"admin\",\"password\":\"${PASSWORD}\"}" \
      "http://127.0.0.1:${PORT}/api/v1/auth/mobile/login" | jq -r .accessToken)"
    [ -n "$token" ] && [ "$token" != null ] || { echo "login failed for $image" >&2; exit 1; }
    for ep in "${ENDPOINTS[@]}"; do
      load -z "$WARMUP" -c 10 -H "Authorization: Bearer $token" "http://app:8080${ep}" > /dev/null 2>&1 || true
    done
    sleep 2
    for ep in "${ENDPOINTS[@]}"; do
      out="$OUT_DIR/r${round}-${tag}-$(echo "$ep" | tr '/' '_').txt"
      load -z "$DURATION" -c "$CONCURRENCY" -H "Authorization: Bearer $token" "http://app:8080${ep}" > "$out" 2>&1
      rps="$(awk '/Requests\/sec:/ {print $2}' "$out")"
      p50="$(awk '/^[[:space:]]+50%/ {printf "%.2f", $3 * 1000}' "$out")"
      p95="$(awk '/^[[:space:]]+95%/ {printf "%.2f", $3 * 1000}' "$out")"
      p99="$(awk '/^[[:space:]]+99%/ {printf "%.2f", $3 * 1000}' "$out")"
      non2xx="$(sed -nE 's/^[[:space:]]*\[([0-9]{3})\][[:space:]]+([0-9]+).*/\1 \2/p' "$out" \
        | awk '$1 < 200 || $1 >= 300 {n += $2} END {print n + 0}')"
      pid="$(java_pid)"
      rss="$(docker exec jdk-bench-app awk '/VmRSS/ {printf "%.0f", $2 / 1024}' "/proc/$pid/status")"
      hwm="$(docker exec jdk-bench-app awk '/VmHWM/ {printf "%.0f", $2 / 1024}' "/proc/$pid/status")"
      cmem="$(docker stats --no-stream --format '{{.MemUsage}}' jdk-bench-app | awk -F' / ' '{print $1}' \
        | awk '/GiB/ {sub("GiB",""); printf "%.0f", $1 * 1024; next} {sub("MiB",""); printf "%.0f", $1}')"
      gc="$(docker exec jdk-bench-app cat /var/log/taskflow/gc.log 2>/dev/null \
        | awk '/Pause/ && $NF ~ /ms$/ {sub(/ms$/, "", $NF); n++; t += $NF} END {printf "%d\t%.1f", n, t}')"
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$round" "$label" "$ep" "$rps" "$p50" "$p95" "$p99" \
        "$non2xx" "$startup" "$rss" "$hwm" "$cmem" "$gc" "$java_version" >> "$RESULTS"
      echo "round $round | $label | $ep | ${rps} req/s | p99 ${p99} ms | rss ${rss} MiB | gc ${gc}"
    done
    docker logs jdk-bench-app > "$OUT_DIR/r${round}-${tag}-app.log" 2>&1 || true
    docker exec jdk-bench-app cat /var/log/taskflow/gc.log > "$OUT_DIR/r${round}-${tag}-gc.log" 2>/dev/null || true
  done
done

echo "==> per-image means (req/s; p99 ms; RSS MiB after the endpoint's run)"
awk -F'\t' 'NR > 1 {
    key = $2 "\t" $3; n[key]++; rps[key] += $4; p99[key] += $7; rss[key] += $10
    if (!(key in min) || $4 < min[key]) min[key] = $4
    if (!(key in max) || $4 > max[key]) max[key] = $4
  }
  END { for (k in n) printf "RESULT | %s | rps=%.0f (min %.0f, max %.0f) | p99=%.2f | rss=%.0f\n",
          k, rps[k] / n[k], min[k], max[k], p99[k] / n[k], rss[k] / n[k] }' "$RESULTS" | sort
echo "==> raw output: $OUT_DIR"
