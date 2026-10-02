#!/usr/bin/env bash
#
# Rebuilds node-forge-1.4.0-patched.tgz from the official npm release plus the
# checked-in backport of upstream PR #1152 (CVE-2026-85393 / GHSA-86w9-cpqp-85rv).
#
# The vendored tarball is consumed by mobile/package.json "overrides"
# (node-forge -> file:vendor/node-forge-1.4.0-patched.tgz) so the fix applies to
# every install, including `npm ci --ignore-scripts`, without forcing the npm
# patchedDependencies lockfileVersion 4 that Renovate cannot parse.
#
# Usage: ./rebuild-node-forge-patch.sh
#
# Regenerate this artifact when node-forge releases a fixed version; at that
# point drop the override entirely (see mobile/README.md).

set -euo pipefail

VERSION="1.4.0"
# npm registry sha512 integrity of the official node-forge@1.4.0 tarball.
EXPECTED_SHA512="LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ=="

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="${HERE}/node-forge-${VERSION}.patch"
OUT_FILE="${HERE}/node-forge-${VERSION}-patched.tgz"

for tool in curl openssl git tar; do
  command -v "${tool}" >/dev/null 2>&1 || {
    echo "ERROR: required tool '${tool}' not found." >&2
    exit 1
  }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

cd "${WORK}"
curl -fsSL "https://registry.npmjs.org/node-forge/-/node-forge-${VERSION}.tgz" -o node-forge.tgz

ACTUAL_SHA512="$(openssl dgst -sha512 -binary node-forge.tgz | openssl base64 -A)"
if [[ "${ACTUAL_SHA512}" != "${EXPECTED_SHA512}" ]]; then
  echo "ERROR: node-forge@${VERSION} integrity mismatch." >&2
  echo "  expected: ${EXPECTED_SHA512}" >&2
  echo "  actual:   ${ACTUAL_SHA512}" >&2
  exit 1
fi

tar xzf node-forge.tgz
(cd package && git apply -p1 "${PATCH_FILE}")

if ! grep -q "obj.value\[0\].value.length" package/lib/rsa.js; then
  echo "ERROR: backport did not apply to lib/rsa.js." >&2
  exit 1
fi

rm -f "${OUT_FILE}"
COPYFILE_DISABLE=1 tar czf "${OUT_FILE}" package

echo "Wrote ${OUT_FILE}"
