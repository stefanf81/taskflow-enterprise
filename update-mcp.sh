#!/usr/bin/env bash
# High-performance, concurrent OpenCode MCP and developer tool updater script.
# Optimizations:
# - Bash Strict Mode (set -euo pipefail).
# - Execution Time tracking ($SECONDS).
# - CLI Arguments parsing (--help, --verbose).
# - Atomic Lockfile to prevent concurrent execution races.
# - Tail-based error reporting (shows exactly why a tool failed).
# - Requirement sanity checking before starting heavy I/O.

set -euo pipefail

# --- Configuration & State ---
LOCK_DIR="/tmp/mcp_updater.lock"
VERBOSE=false
START_TIME=$SECONDS

# --- Help / Usage ---
usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

High-performance, concurrent OpenCode MCP updater.

Options:
    -h, --help       Show this help message and exit
    -v, --verbose    Show verbose output (skip spinner, print logs directly)
EOF
    exit 0
}

# --- CLI Argument Parsing ---
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) usage ;;
        -v|--verbose) VERBOSE=true; shift ;;
        *) echo "Unknown parameter passed: $1"; usage ;;
    esac
done

# --- Atomic Execution Lock ---
# Using mkdir is POSIX-compliant and atomic over NFS/local filesystems.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "❌ Error: Another instance of the updater is already running."
    echo "If this is a mistake, run: rm -rf $LOCK_DIR"
    exit 1
fi

# --- Environment & Formatting Setup ---
if [ -t 1 ] && [ "$VERBOSE" = false ]; then
    GREEN=$(tput setaf 2 || true)
    BLUE=$(tput setaf 4 || true)
    YELLOW=$(tput setaf 3 || true)
    RED=$(tput setaf 1 || true)
    DIM=$(tput dim || true)
    NC=$(tput sgr0 || true)
    USE_SPINNER=true
    tput civis || true # Hide cursor
else
    GREEN=""
    BLUE=""
    YELLOW=""
    RED=""
    DIM=""
    NC=""
    USE_SPINNER=false
fi

# Secure temporary log directory
LOG_DIR=$(mktemp -d -t mcp_updater.XXXXXX)

# --- Cleanup Trap ---
cleanup() {
    local exit_code=$?
    # Remove execution lock
    rm -rf "$LOCK_DIR"
    
    # Suppress job termination messages safely
    kill $(jobs -p) 2>/dev/null || true
    
    if [ "$USE_SPINNER" = true ]; then
        tput cnorm || true # Restore cursor unconditionally
    fi
    exit "$exit_code"
}
trap cleanup SIGINT SIGTERM EXIT

echo -e "${BLUE}===================================================================${NC}"
echo -e "${BLUE}        🚀 Optimizing & Updating OpenCode Dev Environment          ${NC}"
echo -e "${BLUE}        (Running isolated tasks in parallel for max performance)  ${NC}"
echo -e "${BLUE}===================================================================${NC}"

# --- Dependency Sanity Check ---
check_cmd() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${YELLOW}⚠️  Warning: Command '$1' is missing. Tasks depending on it will be skipped.${NC}"
    fi
}
check_cmd "npm"
check_cmd "uv"

# --- Tasks ---
task_go() {
    local GUP_BIN="$HOME/go/bin/gup"
    if [ -f "$GUP_BIN" ]; then
        "$GUP_BIN" update > "$LOG_DIR/go.log" 2>&1
    elif command -v gup &> /dev/null; then
        gup update > "$LOG_DIR/go.log" 2>&1
    elif command -v go &> /dev/null; then
        go install github.com/nao1215/gup@latest > "$LOG_DIR/go.log" 2>&1
        "$GUP_BIN" update >> "$LOG_DIR/go.log" 2>&1
    else
        echo "Go compiler not found" > "$LOG_DIR/go.log"
        return 1
    fi
}

task_npm() {
    if command -v npm &> /dev/null; then
        set +e
        npm update -g > "$LOG_DIR/npm_global.log" 2>&1
        local up_status=$?
        npm cache clean --force > "$LOG_DIR/npm_cache.log" 2>&1
        local cache_status=$?
        set -e
        if [ $up_status -ne 0 ] || [ $cache_status -ne 0 ]; then return 1; fi
    else
        echo "NPM not found" > "$LOG_DIR/npm_global.log"
        return 1
    fi
}

task_uv() {
    local UV_CMD=""
    if command -v uv &> /dev/null; then
        UV_CMD="uv"
    elif [ -f "/opt/homebrew/bin/uv" ]; then
        UV_CMD="/opt/homebrew/bin/uv"
    fi

    if [ -n "$UV_CMD" ]; then
        set +e
        "$UV_CMD" tool upgrade --all > "$LOG_DIR/uv_global.log" 2>&1
        local up_status=$?
        "$UV_CMD" cache clean --force > "$LOG_DIR/uv_cache.log" 2>&1
        local cache_status=$?
        set -e
        if [ $up_status -ne 0 ] || [ $cache_status -ne 0 ]; then return 1; fi
    else
        echo "uv not found" > "$LOG_DIR/uv_global.log"
        return 1
    fi
}

# --- Execution ---
declare -A PIDS
task_go & PIDS[go]=$!
task_npm & PIDS[npm]=$!
task_uv & PIDS[uv]=$!

# Spinner loop
spinner() {
    local delay=0.1
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    
    while true; do
        local active=false
        for pid in "${PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                active=true
                break
            fi
        done
        
        if [ "$active" = false ]; then break; fi

        if [ "$USE_SPINNER" = true ]; then
            local temp=${spinstr#?}
            printf "  ${YELLOW}%c${NC}  Running parallel updates & safe cache clearing..." "$spinstr"
            spinstr=$temp${spinstr%"$temp"}
            sleep $delay
            printf "\r"
        else
            sleep 1
        fi
    done
    
    if [ "$USE_SPINNER" = true ]; then
        printf "                                                                 \r"
    fi
}

if [ "$VERBOSE" = true ]; then
    echo "Running tasks in verbose mode (tailing logs)..."
    tail -f "$LOG_DIR"/*.log & TAIL_PID=$!
    spinner
    kill $TAIL_PID 2>/dev/null || true
else
    spinner
fi

# Collect exit statuses securely
declare -A STATUSES
for task in "${!PIDS[@]}"; do
    wait "${PIDS[$task]}" || STATUSES[$task]=$?
    STATUSES[$task]=${STATUSES[$task]:-0}
done

# --- Results ---
echo -e "\n${BLUE}===================== UPDATE RESULTS =====================${NC}"

# Helper to print errors gracefully
print_error() {
    local log_file=$1
    echo -e " ${RED}✗${NC} $2 : ${RED}Failed${NC}"
    if [ -f "$log_file" ]; then
        echo -e "   ${DIM}└─ Last error: $(tail -n 1 "$log_file" | tr -d '\n' | cut -c 1-80)${NC}"
    fi
}

# Go Summary
if [ "${STATUSES[go]}" -eq 0 ]; then
    echo -e " ${GREEN}✓${NC} Go Binaries (GUP)     : ${GREEN}Up-to-date${NC}"
else
    print_error "$LOG_DIR/go.log" "Go Binaries (GUP)    "
fi

# NPM Summary
if [ "${STATUSES[npm]}" -eq 0 ]; then
    CHANGED_NPM=$(grep -o 'changed [0-9]* packages' "$LOG_DIR/npm_global.log" | head -n 1 || echo "")
    if [ -z "$CHANGED_NPM" ]; then CHANGED_NPM="Up-to-date"; fi
    echo -e " ${GREEN}✓${NC} Global NPM Packages   : ${GREEN}$CHANGED_NPM${NC}"
    echo -e " ${GREEN}✓${NC} NPM npx Cache Reset   : ${GREEN}Cleared${NC}"
else
    print_error "$LOG_DIR/npm_global.log" "Global NPM / Cache   "
fi

# uv Summary
if [ "${STATUSES[uv]}" -eq 0 ]; then
    FREED_UV=$(grep -o 'Removed [0-9]* files.*' "$LOG_DIR/uv_cache.log" | head -n 1 || echo "")
    if [ -z "$FREED_UV" ]; then FREED_UV="Cleared"; fi
    echo -e " ${GREEN}✓${NC} Global uv Tools       : ${GREEN}Up-to-date${NC}"
    echo -e " ${GREEN}✓${NC} uv uvx Cache Reset    : ${GREEN}$FREED_UV${NC}"
else
    print_error "$LOG_DIR/uv_global.log" "Global uv / Cache    "
fi

DURATION=$(( SECONDS - START_TIME ))
echo -e "${BLUE}===================================================================${NC}"
echo -e "${GREEN}🎉 Updates successfully completed in ${DURATION} seconds!${NC}"
echo -e "${YELLOW}⚠️  Please QUIT and RESTART OpenCode for the updates to take effect.${NC}"
echo -e "${BLUE}===================================================================${NC}"