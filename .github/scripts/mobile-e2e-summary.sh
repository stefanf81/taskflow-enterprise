#!/usr/bin/env bash
# Job summary for a mobile Detox run: the slowest backend requests, the
# connection-leak warnings and (iOS, where the sampler runs) the runner's load,
# swap and backend-memory extremes.
#
# Those numbers decide whether a Detox failure was the app or a starved runner
# (BENCHMARKS §71), and reading them meant downloading android-e2e-artifacts /
# ios-e2e-artifacts per run. The artifacts stay; this only lifts the figures
# into the summary so runs can be compared at a glance.
#
# Paths default to where both E2E jobs put them; the load log is used when the
# iOS job's sampler wrote one. Never fails the job: a missing or unexpected
# file is reported, not fatal.
set -uo pipefail

diagnostics_dir="${1:-e2e-backend-diagnostics}"
backend_log="${2:-e2e-backend.log}"
load_log="${3:-${RUNNER_TEMP:-/tmp}/runner-load.log}"
out="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

{
  echo "### Mobile E2E backend and runner"
  echo
} >> "$out"

# `%t %m %U %s %D`: microseconds, and the timestamp is the request's END, so a
# slow request started `duration` earlier (BENCHMARKS §71).
access_log="$(find "$diagnostics_dir" -name 'access_log.*.log' -type f 2>/dev/null | sort | tail -n 1)"
if [[ -n "$access_log" && -s "$access_log" ]]; then
  {
    echo "Slowest backend requests (duration in seconds; the access-log timestamp is the request's end):"
    echo
    echo "| Request | Duration | Status | Ended |"
    echo "| :--- | ---: | ---: | ---: |"
    awk 'NF >= 5 && $NF ~ /^[0-9]+$/ {
           printf "%.2f\t%s %s\t%s\t%s\n", $NF / 1e6, $(NF - 3), $(NF - 2), $(NF - 1), substr($1, index($1, ":") + 1)
         }' "$access_log" \
      | sort -rn | head -n 5 \
      | awk -F'\t' '{ printf "| `%s` | %s s | %s | %s |\n", $2, $1, $3, $4 }'
    echo
  } >> "$out"
else
  echo "No Tomcat access log under \`$diagnostics_dir\`." >> "$out"
  echo >> "$out"
fi

# Hikari's 2 s leak detection (application.properties): a request that held a
# pool connection that long was slow in the database, not merely descheduled.
if [[ -s "$backend_log" ]]; then
  leaks="$(grep -c 'Connection leak detection triggered' "$backend_log")"
  echo "Connection-leak warnings (>2 s holding a pool connection): **${leaks}**" >> "$out"
  echo >> "$out"
fi

# One sample every 5 s; see the "Start sampling runner load" step for the format.
if [[ -s "$load_log" ]]; then
  {
    echo "Runner during the Detox step (${load_log##*/}, one sample every 5 s):"
    echo
    echo "| Metric | Value |"
    echo "| :--- | ---: |"
    awk '
      match($0, /load=[0-9.]+/)      { v = substr($0, RSTART + 5, RLENGTH - 5) + 0; if (v > load) load = v }
      match($0, /free=[0-9]+/)       { v = substr($0, RSTART + 5, RLENGTH - 5) + 0; if (free == "" || v < free) free = v }
      match($0, /swap_used=[0-9.]+/) { v = substr($0, RSTART + 10, RLENGTH - 10) + 0; if (v > swap) swap = v }
      match($0, /backend=[^ ]+/) {
        split(substr($0, RSTART + 8, RLENGTH - 8), be, ",")
        rss = be[2] + 0
        if (rss > 0) {
          if (min == "" || rss < min) min = rss
          if (rss > max) max = rss
        }
        if (be[3] != "") nice = be[3]
      }
      END {
        printf "| Peak 1-min load average | %.0f |\n", load
        printf "| Lowest free memory | %s%% |\n", (free == "" ? "n/a" : free)
        printf "| Peak swap in use | %.0f MB |\n", swap
        # Absent in samples from before the backend column was added.
        if (min != "") printf "| Backend resident memory | %s-%s MB |\n", min, max
        if (nice != "") printf "| Backend priority | %s |\n", nice
        printf "| Samples | %d |\n", NR
      }' "$load_log"
    echo
  } >> "$out"
fi
