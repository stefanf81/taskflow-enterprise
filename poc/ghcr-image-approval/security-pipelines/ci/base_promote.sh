#!/usr/bin/env bash
# Protected promote/sign job; performs independent checks of the untrusted evaluate artifact.
set -Eeuo pipefail
: "${GHCR_HOST:?}" "${GHCR_APPROVED_REPO:?}" "${GHCR_QUARANTINE_REPO:?}" "${APPROVAL_PUBKEY:?}" "${COSIGN_KEY:?}" "${APPROVAL_PREDICATE_TYPE:?}" "${GITHUB_SHA:?}" "${APPROVER_ID:?}"
bash ci/require_ghcr_config.sh base
# shellcheck source=ci/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
readarray -t fields < <(python3 - <<'PY'
import json,re
x=json.load(open('reports/context.json'))
for key in ('upstream_ref','upstream_digest_ref','tag','digest','old_ref','candidate_ref','upstream_signature','git_sha'):
    value=x[key]
    if not isinstance(value,str) or '\n' in value or '\r' in value: raise SystemExit('invalid context '+key)
    print(value)
PY
)
upstream_ref=${fields[0]}; upstream_digest_ref=${fields[1]}; tag=${fields[2]}; digest=${fields[3]}
old_ref=${fields[4]}; candidate_ref=${fields[5]}; signature=${fields[6]}; evaluated_sha=${fields[7]}
[[ "$evaluated_sha" = "$GITHUB_SHA" ]] || { echo 'Evaluation commit mismatch' >&2; exit 1; }
[[ "$upstream_ref" = "$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field upstream_ref)" ]] || exit 1
[[ "$upstream_digest_ref" = "$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field upstream_digest_ref)" ]] || exit 1
[[ "$digest" = "$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field digest)" ]] || exit 1
[[ "$tag" = "$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field tag)" ]] || exit 1
[[ "$old_ref" = "$GHCR_APPROVED_REPO@$(cat reports/previous.digest)" ]] || exit 1
[[ "$candidate_ref" = "$GHCR_QUARANTINE_REPO@$digest" ]] || exit 1
[[ "$(crane digest "$candidate_ref")" = "$digest" ]] || exit 1
[[ "$(crane digest "$upstream_digest_ref")" = "$digest" ]] || exit 1
[[ "$(crane digest "$GHCR_APPROVED_REPO:$tag")" = "$(cat reports/previous.digest)" ]] || { echo 'Baseline moved' >&2; exit 1; }
# Integrity check for protected policy versus evaluate reports, not malware detection.
original_sha="$(sha256sum reports/decision.json | cut -d' ' -f1)"
platforms="$(cat reports/platforms.txt)"
python3 -I scripts/evaluate.py --report-dir reports --platforms "$platforms" \
  --upstream-signature "$signature" --upstream-provenance not_verified --candidate-ref "$candidate_ref" >/dev/null
[[ "$(sha256sum reports/decision.json | cut -d' ' -f1)" = "$original_sha" ]] || { echo 'Policy result changed during review' >&2; exit 1; }
decision="$(python3 -I scripts/evaluate.py --report-dir reports --decision-only)"
case "$decision" in
 BLOCK) echo 'BLOCK: no promotion' >&2; exit 1 ;;
 REVIEW) [[ "$APPROVER_ID" != automatic-policy && -n "$APPROVER_ID" ]] || exit 1 ;;
 AUTO_PASS) [[ "$APPROVER_ID" = automatic-policy ]] || exit 1 ;;
 *) exit 1 ;;
esac
# Refuse to create a new signed assertion for an unsigned old baseline.
cosign verify --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" "$old_ref" >/dev/null
cosign verify-attestation --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" --type "$APPROVAL_PREDICATE_TYPE" "$old_ref" > reports/reverified-old-attestation.json
python3 -I scripts/check_approval_attestation.py reports/reverified-old-attestation.json \
  --predicate-type "$APPROVAL_PREDICATE_TYPE" --digest "$(cat reports/previous.digest)" --expected-ref "$old_ref" \
  --accepted-policy-versions "$(python3 -I scripts/policy_info.py --field historical_baseline_versions)" \
  --max-age-hours "$(python3 -I scripts/policy_info.py --field historical_baseline_max_age_hours)"
# The OLD baseline is checked by accepted policy VERSION only. Its fingerprint is that of the
# code that approved it, which legitimately differs from today's (see policy_fingerprint.py);
# requiring equality here made every change to the fingerprinted files a dead end (v4).
review_tag="reviewed-${digest#sha256:}"
copy_exact "$candidate_ref" "$GHCR_APPROVED_REPO" "$review_tag" "$digest" reports/approved.digest
approved_ref="$GHCR_APPROVED_REPO@$digest"
python3 -I scripts/approval_record.py --decision-file reports/decision.json --evidence-dir reports \
  --upstream-ref "$upstream_ref" --approved-ref "$approved_ref" \
  --approver "$APPROVER_ID" --build-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
  --git-commit "$GITHUB_SHA" --predicate-type "$APPROVAL_PREDICATE_TYPE" \
  --output reports/approval-attestation.json
cosign sign "${COSIGN_SIGN_FLAGS[@]}" --key "$COSIGN_KEY" "$approved_ref"
cosign attest "${COSIGN_SIGN_FLAGS[@]}" --key "$COSIGN_KEY" \
  --type "$APPROVAL_PREDICATE_TYPE" --predicate reports/approval-attestation.json "$approved_ref"
cosign verify --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" "$approved_ref" >/dev/null
cosign verify-attestation --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" --type "$APPROVAL_PREDICATE_TYPE" "$approved_ref" > reports/new-attestation-verified.json
python3 -I scripts/check_approval_attestation.py reports/new-attestation-verified.json \
  --predicate-type "$APPROVAL_PREDICATE_TYPE" --digest "$digest" --expected-ref "$approved_ref" \
  --accepted-policy-versions "$(python3 -I scripts/policy_info.py --field version)" \
  --expected-policy-sha256 "$(python3 -I scripts/policy_info.py --field policy_sha256)"
[[ "$(crane digest "$GHCR_APPROVED_REPO:$tag")" = "$(cat reports/previous.digest)" ]] || { echo 'Baseline tag moved while signing' >&2; exit 1; }
crane tag "$approved_ref" "$tag"
[[ "$(crane digest "$GHCR_APPROVED_REPO:$tag")" = "$digest" ]] || exit 1
printf '%s\n' "$approved_ref" > reports/approved-ref.txt
