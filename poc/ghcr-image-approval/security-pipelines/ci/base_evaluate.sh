#!/usr/bin/env bash
# Runs only from a protected default branch, READ-ONLY (packages: read). Requires a
# pre-bootstrapped signed baseline and the quarantine copy made by ci/base_quarantine.sh.
set -Eeuo pipefail
: "${GHCR_HOST:?}" "${GHCR_APPROVED_REPO:?}" "${GHCR_QUARANTINE_REPO:?}" "${APPROVAL_PUBKEY:?}" "${GITHUB_SHA:?}"
bash ci/require_ghcr_config.sh base
mkdir -p reports
upstream_ref="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field upstream_ref)"
upstream_digest_ref="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field upstream_digest_ref)"
tag="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field tag)"
digest="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field digest)"
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Renovate must pin digest first' >&2; exit 1; }
old_digest="$(crane digest "$GHCR_APPROVED_REPO:$tag")"
[[ "$old_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
old_ref="$GHCR_APPROVED_REPO@$old_digest"
candidate_ref="$GHCR_QUARANTINE_REPO@$digest"
# Validate the previously approved baseline, not just its mutable tracking tag.
cosign verify --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" "$old_ref" > reports/old-signature.json
cosign verify-attestation --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" --type "${APPROVAL_PREDICATE_TYPE:?}" "$old_ref" > reports/old-attestation.json
python3 -I scripts/check_approval_attestation.py reports/old-attestation.json \
  --predicate-type "$APPROVAL_PREDICATE_TYPE" --digest "$old_digest" --expected-ref "$old_ref" \
  --accepted-policy-versions "$(python3 -I scripts/policy_info.py --field historical_baseline_versions)" \
  --max-age-hours "$(python3 -I scripts/policy_info.py --field historical_baseline_max_age_hours)"
# No fingerprint check here: the baseline is only the comparison reference. The fingerprint
# decides in ci/base_precheck.sh whether an already-approved digest must be evaluated again.
[[ "$(crane digest "$upstream_digest_ref")" = "$digest" ]] || { echo 'Upstream digest mismatch' >&2; exit 1; }
# The quarantine copy was made by the separate write-enabled quarantine job (ci/base_quarantine.sh).
# This job only READS: it parses untrusted image content and must not hold a GHCR write token.
[[ "$(crane digest "$candidate_ref")" = "$digest" ]] || { echo 'Quarantine copy missing or different' >&2; exit 1; }
crane manifest "$old_ref" > reports/old-index.json
crane manifest "$candidate_ref" > reports/candidate-index.json
platforms="$(python3 -I scripts/manifest_platforms.py reports/old-index.json reports/candidate-index.json)"
[[ -n "$platforms" ]] || exit 1
printf '%s\n' "$old_digest" > reports/previous.digest
printf '%s\n' "$platforms" > reports/platforms.txt
# Source signature check is publisher-specific; do not claim provenance without validation.
signature=not_verified
if [[ "${VERIFY_UPSTREAM_SIGNATURE:-false}" == true ]]; then
  : "${UPSTREAM_PUBKEY:?VERIFY_UPSTREAM_SIGNATURE=true requires verified publisher key}"
  cosign verify --insecure-ignore-tlog=true --key "$UPSTREAM_PUBKEY" "$upstream_digest_ref" > reports/upstream-signature.json
  signature=verified
fi
printf '%s\n' '{"status":"not_verified","reason":"publisher-specific predicate validation not configured"}' > reports/upstream-provenance.json
export OLD_REF="$old_ref" CANDIDATE_REF="$candidate_ref" PLATFORMS="$platforms" REPORT_DIR=reports
bash scripts/compare.sh
python3 -I scripts/evaluate.py --report-dir reports --platforms "$platforms" \
  --upstream-signature "$signature" --upstream-provenance not_verified --candidate-ref "$candidate_ref"
python3 - "$upstream_ref" "$upstream_digest_ref" "$tag" "$digest" "$old_ref" "$candidate_ref" "$signature" "$GITHUB_SHA" <<'PY'
import json,sys,pathlib
keys=('upstream_ref','upstream_digest_ref','tag','digest','old_ref','candidate_ref','upstream_signature','git_sha')
pathlib.Path('reports/context.json').write_text(json.dumps(dict(zip(keys,sys.argv[1:])),indent=2)+'\n')
PY
python3 -I scripts/evaluate.py --report-dir reports --decision-only
