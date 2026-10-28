#!/usr/bin/env bash
#
# Rebuilds deepmerge-4.3.1-patched.tgz from the official npm release plus the
# checked-in backport deepmerge-4.3.1.patch (GHSA-gcqx-w48m-w2h4).
#
# The vendored tarball is consumed by the root package.json "overrides"
# (deepmerge -> file:mobile/vendor/deepmerge-4.3.1-patched.tgz) so the fix applies to every
# install, including `npm ci --ignore-scripts`, without forcing the npm
# patchedDependencies lockfileVersion 4 that Renovate cannot parse.
#
# Usage: ./rebuild-deepmerge-patch.sh
#
# When deepmerge publishes a fixed release its dependents accept, drop the override
# and this directory's deepmerge files (see README.md).

set -euo pipefail

NAME="deepmerge"
VERSION="4.3.1"
# npm registry sha512 integrity of the official deepmerge@4.3.1 tarball.
EXPECTED_SHA512="3sUqbMEc77XqpdNO7FRyRog+eW3ph+GYCbj+rK+uYyRMuwsVy0rMiVtPn+QJlKFvWP/1PYpapqYn0Me2knFn+A=="

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

for file in index.js dist/cjs.js dist/umd.js; do
  if [[ "$(grep -cE "^[[:space:]]+setOwnProperty\(destination, key," "package/${file}")" != 3 ]]; then
    echo "ERROR: backport did not reach every mergeObject() assignment in ${file}." >&2
    exit 1
  fi
done

rm -f "${OUT_FILE}"
COPYFILE_DISABLE=1 tar czf "${OUT_FILE}" package

echo "Wrote ${OUT_FILE}"
echo
echo "NOTE: the rebuilt tarball has new bytes, so the integrity recorded in"
echo "the root package-lock.json is now stale. From the repository root run:"
echo "  npm install && npm ci && npm test --workspace mobile"
echo "then commit the tarball together with the lockfile."
