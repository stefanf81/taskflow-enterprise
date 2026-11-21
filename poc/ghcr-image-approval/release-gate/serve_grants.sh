#!/usr/bin/env bash
# Publish release grants on the orphan `grants` branch of this repository, where the release
# pipeline reads them from raw.githubusercontent.com:
#   https://raw.githubusercontent.com/<this repo>/refs/heads/grants/<commit>
#
#   serve_grants.sh serve     re-issue a fresh grant every GRANT_INTERVAL_SECONDS (default 60)
#                             for GRANT_MINUTES (1..90), then stop
#   serve_grants.sh withdraw  stop a serve loop that is still running, then publish an empty
#                             branch (run on success, failure and cancel)
#
# The release pipeline requires a grant issued at most 10 minutes before EACH of its two
# fetches, and raw.githubusercontent.com caches for up to 5 minutes, hence the re-issuing.
# The branch always holds a single commit (force-pushed), so it does not grow. It holds one
# grant at a time; the workflow's concurrency group queues a second dispatch, so cancel the
# running one before granting another commit.
#
# A required CI run that has not finished yet (a re-run, or the gate started before CI was
# done) is not a refusal: the loop issues no new grant that round and asks again. A finished
# run that did not succeed, or a moved main HEAD, withdraws the grant and ends the run.
#
# Revocation must not be undone by a push that was still in flight when the run was cancelled
# (the runner kills only the step's process; a running `git push` child can outlive it). So the
# serve loop pushes with --force-with-lease against the commit it pushed last: once withdraw has
# replaced the branch, every later serve push is rejected by GitHub and the loop stops.
# Run `serve` with `exec` from the workflow step, so that a cancel signal reaches this process
# and the loop stops at once instead of sleeping on.
set -Eeuo pipefail
: "${APP_REPOSITORY:?}" "${APP_COMMIT:?}" "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${RUNNER_TEMP:?}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:-}"
work="$RUNNER_TEMP/grants-branch-$mode"      # serve and withdraw never share a directory
pidfile="$RUNNER_TEMP/serve-grants.pid"
remote="https://github.com/$GITHUB_REPOSITORY.git"

retry() {   # three attempts for calls that can fail transiently (git push)
  local attempt
  for attempt in 1 2 3; do
    "$@" && return 0
    [[ "$attempt" = 3 ]] || sleep 5
  done
  return 1
}

fetch() {   # fetch OUTFILE COMMAND...: like retry, and OUTFILE holds only the last attempt's output
  local out="$1" attempt
  shift
  for attempt in 1 2 3; do
    if "$@" > "$out"; then return 0; fi
    [[ "$attempt" = 3 ]] || sleep 5
  done
  return 1
}

git_auth() {   # git with the token as an HTTP header, never in a URL or on disk
  local auth
  auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
  git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" "$@"
}

push_branch() {   # push_branch [LEASE]: with LEASE, only if the branch is still at LEASE ('' = absent)
  if [[ $# -gt 0 ]]; then
    git_auth -C "$work" push -q --force-with-lease="refs/heads/grants:$1" "$remote" HEAD:refs/heads/grants
  else
    git_auth -C "$work" push -q --force "$remote" HEAD:refs/heads/grants
  fi
}

publish() {   # publish GRANT_FILE|'' [LEASE]: a single-commit branch holding the grant (or none)
  local grant="$1"
  shift
  rm -rf "$work"
  mkdir -p "$work"
  git -C "$work" init -q -b grants
  if [[ -n "$grant" ]]; then
    cp "$grant" "$work/$APP_COMMIT"
  fi
  printf 'Release grants issued by %s; each file is named after an application commit.\n' \
    "$GITHUB_REPOSITORY" > "$work/README.md"
  git -C "$work" add -A
  git -C "$work" -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -q -m "release grants $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  retry push_branch "$@"
}

stop_serve_loop() {   # make sure no serve loop can publish after the withdrawal
  local pid
  [[ -f "$pidfile" ]] || return 0
  pid="$(cat "$pidfile")"
  rm -f "$pidfile"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -TERM "$pid" 2>/dev/null || return 0
  for _ in $(seq 1 50); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  kill -KILL "$pid" 2>/dev/null || true
}

case "$mode" in
  withdraw)
    stop_serve_loop
    publish ''
    echo "Grant withdrawn: refs/heads/grants holds no grant"
    ;;
  serve)
    : "${GRANT_MINUTES:?}" "${GATE_PRIVATE_KEY_B64:?}"
    # Decimal only: bash arithmetic would read a leading 0 as octal ("060" = 48 minutes).
    if ! [[ "$GRANT_MINUTES" =~ ^[1-9][0-9]?$ ]] || (( 10#$GRANT_MINUTES > 90 )); then
      echo 'minutes must be a whole number from 1 to 90' >&2
      exit 1
    fi
    interval="${GRANT_INTERVAL_SECONDS:-60}"
    if ! [[ "$interval" =~ ^[1-9][0-9]?$ ]] || (( 10#$interval > 60 )); then
      echo 'GRANT_INTERVAL_SECONDS must be a whole number from 1 to 60' >&2
      exit 1
    fi
    minutes=$((10#$GRANT_MINUTES))
    interval=$((10#$interval))
    echo "$$" > "$pidfile"
    sleeper=''
    trap 'rm -f "$pidfile"' EXIT
    trap 'echo "Gate stopped by signal" >&2; [[ -z "$sleeper" ]] || kill "$sleeper" 2>/dev/null; exit 130' INT TERM
    umask 077
    key="$RUNNER_TEMP/gate.key"
    printf '%s' "$GATE_PRIVATE_KEY_B64" | base64 -d > "$key"
    # Where the branch is now; every serve push must find it exactly where we left it.
    fetch "$RUNNER_TEMP/grants-remote.txt" git_auth ls-remote "$remote" refs/heads/grants
    lease="$(cut -f1 "$RUNNER_TEMP/grants-remote.txt")"
    end=$((SECONDS + minutes * 60))
    while :; do
      fetch "$RUNNER_TEMP/head.txt" gh api "repos/$APP_REPOSITORY/git/ref/heads/main" --jq .object.sha
      head="$(cat "$RUNNER_TEMP/head.txt")"
      fetch "$RUNNER_TEMP/workflow-runs.json" \
        gh api "repos/$APP_REPOSITORY/actions/runs?head_sha=$APP_COMMIT&event=push&branch=main&per_page=100"
      verdict=0
      python3 -I "$here/issue_grant.py" --repository "$APP_REPOSITORY" --commit "$APP_COMMIT" \
        --head-sha "$head" --workflow-runs "$RUNNER_TEMP/workflow-runs.json" \
        --allowlist "$here/allowlist.json" --key "$key" --output "$RUNNER_TEMP/grant.json" || verdict=$?
      case "$verdict" in
        0)
          publish "$RUNNER_TEMP/grant.json" "$lease"
          lease="$(git -C "$work" rev-parse HEAD)"
          echo "$(date -u +%H:%M:%S) grant for $APP_REPOSITORY@$APP_COMMIT re-issued"
          ;;
        3)
          # CI still running (a re-run, or the gate started early): issue nothing new and ask
          # again next round. A grant published earlier is left alone; it ages out of the
          # pipeline's 10-minute window by itself if CI stays unfinished.
          echo "$(date -u +%H:%M:%S) CI run for $APP_COMMIT not finished: no new grant this round"
          ;;
        *)
          publish '' "$lease"
          echo 'Grant refused and withdrawn' >&2
          exit 1
          ;;
      esac
      remaining=$((end - SECONDS))
      (( remaining > 0 )) || break
      # In the background and waited for, so the trap runs at once instead of after the sleep.
      sleep "$(( remaining < interval ? remaining : interval ))" &
      sleeper="$!"
      wait "$sleeper"
      sleeper=''
      (( SECONDS < end )) || break
    done
    ;;
  *) echo 'Usage: serve_grants.sh {serve|withdraw}' >&2; exit 2 ;;
esac
