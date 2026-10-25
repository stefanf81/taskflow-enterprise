#!/usr/bin/env bash
# Concurrent developer-tool updates. Compatible with macOS Bash 3.2.
set -euo pipefail

VERBOSE=false
CLEAN_CACHE=false
START_TIME=$SECONDS
LOG_DIR=""
LOCK_OWNED=false
CURSOR_HIDDEN=false
TAIL_PID=""
PIDS=()
TASKS=(go npm uv)
STATUSES=()
LOCK_DIR="${TMPDIR:-/tmp}/mcp_updater-${UID}.lock"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Update Go binaries (gup), global npm packages, and installed uv tools.

Options:
    -h, --help       Show this help message
    -v, --verbose    Stream task logs instead of showing a spinner
    --clean-cache    Also clear npm and uv caches (respects uv cache locks)
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        -v|--verbose) VERBOSE=true ;;
        --clean-cache) CLEAN_CACHE=true ;;
        *) printf 'Unknown parameter: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

# Give each worker its own process group, including external-command children.
# This is also the cancellation pattern used by verify.sh.
set -m

cleanup() {
    local status=$? pid attempt active
    trap - EXIT
    trap '' INT TERM
    if [[ -n "$TAIL_PID" ]]; then
        kill "$TAIL_PID" 2>/dev/null || true
        wait "$TAIL_PID" 2>/dev/null || true
    fi
    if [[ ${#PIDS[@]} -gt 0 ]]; then
        for pid in "${PIDS[@]}"; do
            kill -TERM -- "-$pid" 2>/dev/null || true
        done
        # Bound shutdown, then kill any surviving descendants before unlocking.
        for attempt in {1..30}; do
            active=false
            for pid in "${PIDS[@]}"; do
                if kill -0 -- "-$pid" 2>/dev/null; then active=true; fi
            done
            if [[ "$active" = false ]]; then break; fi
            sleep 0.1
        done
        for pid in "${PIDS[@]}"; do
            kill -KILL -- "-$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        done
    fi
    if [[ "$CURSOR_HIDDEN" = true ]]; then tput cnorm 2>/dev/null || true; fi
    if [[ -n "$LOG_DIR" ]]; then
        if [[ "$status" -eq 0 ]]; then
            rm -rf -- "$LOG_DIR"
        else
            printf 'Logs retained at: %s\n' "$LOG_DIR" >&2
        fi
    fi
    if [[ "$LOCK_OWNED" = true ]]; then
        rm -f -- "$LOCK_DIR/pid"
        rmdir -- "$LOCK_DIR" || true
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Never automatically delete a lock based on a missing/dead PID: that races
# another process acquiring the lock. SIGKILL recovery is deliberately manual.
if mkdir -m 700 "$LOCK_DIR" 2>/dev/null; then
    LOCK_OWNED=true
else
    printf 'Cannot acquire lock: %s\nAnother updater may be running, or the directory is not writable.\n' "$LOCK_DIR" >&2
    printf 'If stale, verify no updater or update child is running before removing it.\n' >&2
    exit 1
fi
printf '%s\n' "$$" > "$LOCK_DIR/pid"
LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mcp_updater.XXXXXX")
for task in "${TASKS[@]}"; do : > "$LOG_DIR/$task.log"; done

task_go() {
    local gup_bin gobin gopath
    if command -v gup >/dev/null 2>&1; then
        gup_bin=$(command -v gup)
    elif [[ -x "$HOME/go/bin/gup" ]]; then
        gup_bin="$HOME/go/bin/gup"
    elif command -v go >/dev/null 2>&1; then
        gobin=$(go env GOBIN)
        if [[ -z "$gobin" ]]; then
            gopath=$(go env GOPATH)
            gobin="${gopath%%:*}/bin"
        fi
        if [[ -x "$gobin/gup" ]]; then
            gup_bin="$gobin/gup"
        else
            printf '%s\n' 'Step: install gup'
            go install github.com/nao1215/gup@latest
            gup_bin="$gobin/gup"
        fi
    else
        printf '%s\n' 'Skipped: neither gup nor Go is available.'
        : > "$LOG_DIR/go.skipped"
        return 0
    fi
    printf '%s\n' 'Step: update Go binaries'
    "$gup_bin" update
}

task_npm() {
    if ! command -v npm >/dev/null 2>&1; then
        printf '%s\n' 'Skipped: npm is unavailable.'
        : > "$LOG_DIR/npm.skipped"
        return 0
    fi
    printf '%s\n' 'Step: update global npm packages'
    npm update -g
    if [[ "$CLEAN_CACHE" = true ]]; then
        printf '%s\n' 'Step: clear npm cache'
        npm cache clean --force
    fi
}

task_uv() {
    local uv_cmd
    if command -v uv >/dev/null 2>&1; then
        uv_cmd=$(command -v uv)
    elif [[ -x /opt/homebrew/bin/uv ]]; then
        uv_cmd=/opt/homebrew/bin/uv
    else
        printf '%s\n' 'Skipped: uv is unavailable.'
        : > "$LOG_DIR/uv.skipped"
        return 0
    fi
    printf '%s\n' 'Step: upgrade installed uv tools'
    "$uv_cmd" tool upgrade --all
    if [[ "$CLEAN_CACHE" = true ]]; then
        printf '%s\n' 'Step: clear uv cache (waiting for other uv users if necessary)'
        "$uv_cmd" cache clean
    fi
}

printf '%s\n' 'Updating Go, npm, and uv tools in parallel...'
for task in "${TASKS[@]}"; do
    "task_$task" > "$LOG_DIR/$task.log" 2>&1 &
    PIDS[${#PIDS[@]}]=$!
done

USE_SPINNER=false
if [[ -t 1 && "$VERBOSE" = false ]]; then
    USE_SPINNER=true
    if tput civis 2>/dev/null; then CURSOR_HIDDEN=true; fi
fi
if [[ "$VERBOSE" = true ]]; then
    tail -n +1 -f "$LOG_DIR/go.log" "$LOG_DIR/npm.log" "$LOG_DIR/uv.log" &
    TAIL_PID=$!
fi

frames=('|' '/' '-' '\')
frame=0
while :; do
    active=false
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then active=true; break; fi
    done
    if [[ "$active" = false ]]; then break; fi
    if [[ "$USE_SPINNER" = true ]]; then
        printf '\r  %s Updating tools...' "${frames[$frame]}"
        frame=$(( (frame + 1) % ${#frames[@]} ))
    fi
    sleep 0.1
done
if [[ "$USE_SPINNER" = true ]]; then printf '\r%40s\r' ''; fi

for ((i=0; i<${#PIDS[@]}; i++)); do
    status=0
    wait "${PIDS[$i]}" || status=$?
    STATUSES[$i]=$status
done
PIDS=()
if [[ -n "$TAIL_PID" ]]; then
    kill "$TAIL_PID" 2>/dev/null || true
    wait "$TAIL_PID" 2>/dev/null || true
    TAIL_PID=""
fi

failures=0
for ((i=0; i<${#TASKS[@]}; i++)); do
    task=${TASKS[$i]}
    case "${STATUSES[$i]}" in
        0)
            if [[ -f "$LOG_DIR/$task.skipped" ]]; then
                printf '%s: skipped (tool unavailable)\n' "$task"
            else
                printf '%s: completed\n' "$task"
            fi
            ;;
        *)
            printf '%s: FAILED (exit %s)\n' "$task" "${STATUSES[$i]}" >&2
            tail -n 12 "$LOG_DIR/$task.log" >&2
            failures=$((failures + 1))
            ;;
    esac
done
printf 'Finished in %s seconds; %s failed task(s).\n' "$((SECONDS - START_TIME))" "$failures"
printf '%s\n' 'Restart affected running MCP servers to load updated versions.'
if [[ "$failures" -gt 0 ]]; then exit 1; fi
