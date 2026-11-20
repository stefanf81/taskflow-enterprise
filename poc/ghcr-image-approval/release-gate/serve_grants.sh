#!/usr/bin/env bash
# Publish release grants on the orphan `grants` branch of this repository, where the release
# pipeline reads them from raw.githubusercontent.com:
#   https://raw.githubusercontent.com/<this repo>/refs/heads/grants/<commit>
#
#   serve_grants.sh serve     re-issue a fresh grant every 60 s for GRANT_MINUTES, then stop
#   serve_grants.sh withdraw  publish an empty branch (run on success, failure and cancel)
#
# The release pipeline requires a grant issued at most 10 minutes before EACH of its two
# fetches, and raw.githubusercontent.com caches for up to 5 minutes, hence the re-issuing.
# The branch always holds a single commit (force-pushed), so it does not grow. One grant at a
# time: a new grant replaces the previous application commit's grant.
set -Eeuo pipefail
: "${APP_REPOSITORY:?}" "${APP_COMMIT:?}" "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${RUNNER_TEMP:?}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$RUNNER_TEMP/grants-branch"

publish() {   # publish [GRANT_FILE]; without a file the branch holds no grant
  rm -rf "$work"
  mkdir -p "$work"
  git -C "$work" init -q -b grants
  if [[ -n "${1:-}" ]]; then
    cp "$1" "$work/$APP_COMMIT"
  fi
  printf 'Release grants issued by %s; each file is named after an application commit.\n' \
    "$GITHUB_REPOSITORY" > "$work/README.md"
  git -C "$work" add -A
  git -C "$work" -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -q -m "release grants $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local auth
  auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
  git -C "$work" -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" \
    push -q --force "https://github.com/$GITHUB_REPOSITORY.git" HEAD:refs/heads/grants
}

case "${1:-}" in
  withdraw)
    publish
    echo "Grant withdrawn: refs/heads/grants holds no grant"
    ;;
  serve)
    : "${GRANT_MINUTES:?}" "${GATE_PRIVATE_KEY_B64:?}"
    [[ "$GRANT_MINUTES" =~ ^[0-9]+$ ]] && (( GRANT_MINUTES >= 1 && GRANT_MINUTES <= 90 )) || {
      echo 'minutes must be 1..90' >&2; exit 1; }
    umask 077
    key="$RUNNER_TEMP/gate.key"
    printf '%s' "$GATE_PRIVATE_KEY_B64" | base64 -d > "$key"
    end=$((SECONDS + GRANT_MINUTES * 60))
    while :; do
      head="$(gh api "repos/$APP_REPOSITORY/git/ref/heads/main" --jq .object.sha)"
      gh api "repos/$APP_REPOSITORY/commits/$APP_COMMIT/check-runs?per_page=100" > "$RUNNER_TEMP/check-runs.json"
      if ! python3 -I "$here/issue_grant.py" --repository "$APP_REPOSITORY" --commit "$APP_COMMIT" \
          --head-sha "$head" --check-runs "$RUNNER_TEMP/check-runs.json" \
          --allowlist "$here/allowlist.json" --key "$key" --output "$RUNNER_TEMP/grant.json"; then
        publish
        echo 'Grant refused and withdrawn' >&2
        exit 1
      fi
      publish "$RUNNER_TEMP/grant.json"
      echo "$(date -u +%H:%M:%S) grant for $APP_REPOSITORY@$APP_COMMIT re-issued"
      (( SECONDS + 60 < end )) || break
      sleep 60
    done
    ;;
  *) echo 'Usage: serve_grants.sh {serve|withdraw}' >&2; exit 2 ;;
esac
