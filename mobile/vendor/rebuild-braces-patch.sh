#!/usr/bin/env bash
#
# Rebuilds braces-3.0.3-patched.tgz from the official npm release plus the
# checked-in backport of upstream PR #72 (CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm).
#
# The vendored tarball is consumed by mobile/package.json "overrides"
# (braces -> file:vendor/braces-3.0.3-patched.tgz) so the fix applies to every
# install, including `npm ci --ignore-scripts`, without forcing the npm
# patchedDependencies lockfileVersion 4 that Renovate cannot parse.
#
# Usage: ./rebuild-braces-patch.sh
#
# Regenerate this artifact when braces releases a fixed version; at that point
# drop the override entirely (see mobile/README.md).

set -euo pipefail

VERSION="3.0.3"
# npm registry sha512 integrity of the official braces@3.0.3 tarball.
EXPECTED_SHA512="yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA=="

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="${HERE}/braces-${VERSION}.patch"
OUT_FILE="${HERE}/braces-${VERSION}-patched.tgz"

for tool in curl openssl git tar; do
  command -v "${tool}" >/dev/null 2>&1 || {
    echo "ERROR: required tool '${tool}' not found." >&2
    exit 1
  }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

cd "${WORK}"
curl -fsSL "https://registry.npmjs.org/braces/-/braces-${VERSION}.tgz" -o braces.tgz

ACTUAL_SHA512="$(openssl dgst -sha512 -binary braces.tgz | openssl base64 -A)"
if [[ "${ACTUAL_SHA512}" != "${EXPECTED_SHA512}" ]]; then
  echo "ERROR: braces@${VERSION} integrity mismatch." >&2
  echo "  expected: ${EXPECTED_SHA512}" >&2
  echo "  actual:   ${ACTUAL_SHA512}" >&2
  exit 1
fi

tar xzf braces.tgz
(cd package && git apply -p1 "${PATCH_FILE}")

if ! grep -q "MAX_DEPTH" package/lib/constants.js ||
  ! grep -q "maxDepth" package/lib/parse.js ||
  ! grep -q "exceeds max depth" package/lib/compile.js ||
  ! grep -q "exceeds max depth" package/lib/expand.js ||
  ! grep -q "exceeds max depth" package/lib/stringify.js; then
  echo "ERROR: backport did not apply to all lib/ walkers." >&2
  exit 1
fi

rm -f "${OUT_FILE}"
COPYFILE_DISABLE=1 tar czf "${OUT_FILE}" package

echo "Wrote ${OUT_FILE}"
echo
echo "NOTE: the rebuilt tarball has new bytes, so the integrity recorded in"
echo "mobile/package-lock.json is now stale. From mobile/ run:"
echo "  npm install && npm ci && npm test"
echo "then commit the tarball together with the lockfile."
