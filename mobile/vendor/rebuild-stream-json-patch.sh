#!/usr/bin/env bash
#
# Rebuilds stream-json-1.9.1-patched.tgz from the official npm release plus the
# checked-in backport stream-json-1.9.1.patch (GHSA-mjw6-4jj6-33hc, GHSA-528h-pc64-c93x).
#
# The vendored tarball is consumed by the root package.json "overrides"
# (stream-json -> file:mobile/vendor/stream-json-1.9.1-patched.tgz) so the fix applies to every
# install, including `npm ci --ignore-scripts`, without forcing the npm
# patchedDependencies lockfileVersion 4 that Renovate cannot parse.
#
# Usage: ./rebuild-stream-json-patch.sh
#
# When stream-json publishes a fixed release its dependents accept, drop the override
# and this directory's stream-json files (see README.md).

set -euo pipefail

NAME="stream-json"
VERSION="1.9.1"
# npm registry sha512 integrity of the official stream-json@1.9.1 tarball.
EXPECTED_SHA512="uWkjJ+2Nt/LO9Z/JyKZbMusL8Dkh97uUBTv3AJQ74y07lVahLY4eEFsPsE97pxYBwr8nnjMAIch5eqI0gPShyw=="

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="${HERE}/${NAME}-${VERSION}.patch"
OUT_FILE="${HERE}/${NAME}-${VERSION}-patched.tgz"

for tool in curl openssl git tar; do
  command -v "${tool}" >/dev/null 2>&1 || {
    echo "ERROR: required tool '${tool}' not found." >&2
    exit 1
  }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

cd "${WORK}"
curl -fsSL "https://registry.npmjs.org/${NAME}/-/${NAME}-${VERSION}.tgz" -o package.tgz

ACTUAL_SHA512="$(openssl dgst -sha512 -binary package.tgz | openssl base64 -A)"
if [[ "${ACTUAL_SHA512}" != "${EXPECTED_SHA512}" ]]; then
  echo "ERROR: ${NAME}@${VERSION} integrity mismatch." >&2
  echo "  expected: ${EXPECTED_SHA512}" >&2
  echo "  actual:   ${ACTUAL_SHA512}" >&2
  exit 1
fi

tar xzf package.tgz
(cd package && git apply -p1 "${PATCH_FILE}")

if [[ "$(grep -c "setProperty(this.current, this.key, value)" package/Assembler.js)" != 2 ]] ||
  ! grep -q "exceeds maxDepth" package/filters/FilterBase.js; then
  echo "ERROR: backport did not apply to Assembler.js and filters/FilterBase.js." >&2
  exit 1
fi

rm -f "${OUT_FILE}"
COPYFILE_DISABLE=1 tar czf "${OUT_FILE}" package

echo "Wrote ${OUT_FILE}"
echo
echo "NOTE: the rebuilt tarball has new bytes, so the integrity recorded in"
echo "the root package-lock.json is now stale. From the repository root run:"
echo "  npm install && npm ci && npm test --workspace mobile"
echo "then commit the tarball together with the lockfile."
