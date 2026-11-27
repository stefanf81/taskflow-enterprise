#!/usr/bin/env bash
# Standalone reproducer for the JDK 26/27 virtual-thread regression (BENCHMARKS.md §86).
#
# Runs TimedWaitBench on the Temurin 25, 26 and 27 JREs (digest-pinned, the images §86
# measured), 2 pinned cores each, interleaved rounds with rotating order. PATCH=1 adds
# "27p": 27 with the diagnostic java.base patch from patch-tool/AddNoUserHelp.java,
# which gives ForkJoinTask.adapt()'s AdaptedRunnableAction the NO_USER_HELP bit
# (diagnostic only; it changes adapt() for every caller).
#
# Env: ROUNDS (3), GC (-XX:+UseG1GC), KIND (virtual|platform), PATCH (0|1),
#      VERSIONS ("25 26 27"), MODES ("timed untimed").
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ROUNDS="${ROUNDS:-3}"; GC="${GC:--XX:+UseG1GC}"; KIND="${KIND:-virtual}"; PATCH="${PATCH:-0}"
read -r -a VERSIONS <<< "${VERSIONS:-25 26 27}"
read -r -a MODES <<< "${MODES:-timed untimed}"
declare -A IMG=(
  [25]=eclipse-temurin:25-jre-resolute@sha256:a0862ac8790c648f6b5db8a113b9990d24fbe8e65f3c4ba8d68b0302d270c1e6
  [26]=eclipse-temurin:26-jre-resolute@sha256:49c4e52327ba17a83ca5aeb288583805958784a724bce03d97e1092c636221c7
  [27]=eclipse-temurin:27-jre-resolute@sha256:ad293220c45600f71afe656fa0fb14fa9ebba05afee20745c6b627242493e675
)
IMG[27p]="${IMG[27]}"

# Compile once for release 25 (runs unchanged on 26 and 27).
if [ ! -f classes/TimedWaitBench.class ]; then
  docker run --rm -v "$PWD:/w" -w /w eclipse-temurin:25-jdk-resolute \
    javac --release 25 -d classes TimedWaitBench.java ParkPingPong.java
fi
if [ "$PATCH" = 1 ]; then
  VERSIONS+=(27p)
  [ -f "patch27/java/util/concurrent/ForkJoinTask\$AdaptedRunnableAction.class" ] || \
    docker run --rm -v "$PWD:/w" eclipse-temurin:27-jdk-resolute java /w/patch-tool/AddNoUserHelp.java /w/patch27
fi

VARIANTS=()
for m in "${MODES[@]}"; do for v in "${VERSIONS[@]}"; do VARIANTS+=("$v:$m"); done; done
n=${#VARIANTS[@]}
for r in $(seq 1 "$ROUNDS"); do
  for k in $(seq 0 $((n - 1))); do
    IFS=: read -r v mode <<< "${VARIANTS[$(( (k + r - 1) % n ))]}"
    extra=(); mounts=()
    [ "$v" = 27p ] && { extra=(--patch-module java.base=/patch); mounts=(-v "$PWD/patch27:/patch:ro"); }
    docker run --rm --cpuset-cpus 0,1 --memory 2560m -v "$PWD/classes:/c:ro" \
      ${mounts[@]+"${mounts[@]}"} --entrypoint java "${IMG[$v]}" \
      -Xms1g -Xmx1g $GC ${extra[@]+"${extra[@]}"} -cp /c TimedWaitBench 50 3 20 10 20 "$mode" "$KIND" 2>&1 \
      | grep '^java=' | sed "s/^/round $r | $v | /"
  done
done
