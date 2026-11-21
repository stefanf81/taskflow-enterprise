#!/usr/bin/env bash
# Check the tools a job needs BEFORE it uses credentials.
#   * Pinned tools (the list comes from ci/install_verified_tools.py, the single source) must
#     resolve to the directory the checksum-verifying installer filled. On GitHub Actions a
#     copy of the same tool from the runner image is refused, not used.
#   * Host tools (python3, sha256sum, and docker from the SHA-pinned setup-docker-action) only
#     need to exist.
set -Eeuo pipefail
kind="${1:?job toolset}"
host=(python3 sha256sum)
case "$kind" in
  base|promote|scan|push|rescan) ;;
  image-build) host+=(docker) ;;
  *) echo 'Unknown job toolset' >&2; exit 1 ;;
esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mapfile -t pinned < <(python3 -I "$here/install_verified_tools.py" --kind "$kind" --list)
for bin in "${host[@]}" "${pinned[@]}"; do
  command -v "$bin" >/dev/null || { echo "Missing $bin. Run ci/install_verified_tools.py --kind $kind first; do not curl-pipe shell." >&2; exit 1; }
done
verified="${VERIFIED_TOOLS_DIR:-}"
if [[ -z "$verified" && "${GITHUB_ACTIONS:-}" == true ]]; then
  echo 'VERIFIED_TOOLS_DIR is not set: ci/install_verified_tools.py did not run in this job' >&2
  exit 1
fi
if [[ -n "$verified" ]]; then
  for bin in "${pinned[@]}"; do
    resolved="$(command -v "$bin")"
    [[ "$resolved" == "$verified/$bin" ]] || {
      echo "$bin resolves to $resolved, not to the verified copy in $verified. Refusing an unpinned host tool." >&2
      exit 1
    }
  done
else
  echo "WARNING: not on GitHub Actions and VERIFIED_TOOLS_DIR unset; pinned tools were only checked for presence" >&2
fi
