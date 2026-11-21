#!/usr/bin/env bash
# The ONLY base-image step that writes to GHCR before approval: copy the pinned upstream
# digest into the quarantine package. It does not unpack, scan or diff anything - those
# steps parse untrusted image content and run in the read-only evaluate job.
set -Eeuo pipefail
: "${GHCR_HOST:?}" "${GHCR_APPROVED_REPO:?}" "${GHCR_QUARANTINE_REPO:?}"
# shellcheck source=ci/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
bash ci/require_ghcr_config.sh base
mkdir -p reports
upstream_digest_ref="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field upstream_digest_ref)"
digest="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field digest)"
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Renovate must pin digest first' >&2; exit 1; }
[[ "$(crane digest "$upstream_digest_ref")" = "$digest" ]] || { echo 'Upstream digest mismatch' >&2; exit 1; }
review_tag="candidate-${digest#sha256:}"
copy_exact "$upstream_digest_ref" "$GHCR_QUARANTINE_REPO" "$review_tag" "$digest" reports/quarantine.digest
[[ "$(crane digest "$GHCR_QUARANTINE_REPO@$digest")" = "$digest" ]] || exit 1
echo "Quarantined $GHCR_QUARANTINE_REPO@$digest"
