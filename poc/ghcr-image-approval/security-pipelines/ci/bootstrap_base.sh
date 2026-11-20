#!/usr/bin/env bash
# PoC addition (not in the kit): import and sign the FIRST approved base-image baseline.
#
# The normal base pipeline compares a candidate with the previously approved digest, so it
# cannot start from nothing. This script, run only by .github/workflows/base-bootstrap.yml
# behind the base-manual-approval environment, copies the digest pinned in
# catalog/Dockerfile.temurin into approved/ and signs a record that is deliberately WEAK:
#   * "bootstrap": true and NO policy_sha256 (scripts/approval_record.py --bootstrap);
#   * accepted as the comparison baseline of the next evaluation (ci/base_evaluate.sh and
#     ci/base_promote.sh check policy version and age only);
#   * refused by ci/base_precheck.sh and scripts/verify_bases.sh, which require the current
#     policy fingerprint. No application can use the digest until base-image-approval.yml has
#     evaluated it (against itself) and a reviewer has approved that run.
# It refuses to run when the tracking tag already exists: every later approval belongs to the
# normal pipeline.
set -Eeuo pipefail
: "${GHCR_HOST:?}" "${GHCR_APPROVED_REPO:?}" "${GHCR_QUARANTINE_REPO:?}" "${APPROVAL_PUBKEY:?}" \
  "${COSIGN_KEY:?}" "${APPROVAL_PREDICATE_TYPE:?}" "${GITHUB_SHA:?}" "${APPROVER_ID:?}" "${CONFIRM_DIGEST:?}"
bash ci/require_ghcr_config.sh base
# shellcheck source=ci/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
mkdir -p reports
upstream_ref="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field upstream_ref)"
upstream_digest_ref="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field upstream_digest_ref)"
tag="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field tag)"
digest="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field digest)"
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Pin a digest in catalog/Dockerfile.temurin first' >&2; exit 1; }
[[ "$CONFIRM_DIGEST" = "$digest" ]] || { echo "confirm_digest $CONFIRM_DIGEST is not the catalog pin $digest" >&2; exit 1; }
[[ "$APPROVER_ID" != automatic-policy ]] || exit 1
[[ "$(crane digest "$upstream_digest_ref")" = "$digest" ]] || { echo 'Upstream digest mismatch' >&2; exit 1; }

# A job with packages: write can always read, so a failed lookup means "no baseline yet".
if existing="$(crane digest "$GHCR_APPROVED_REPO:$tag" 2>/dev/null)"; then
  echo "$GHCR_APPROVED_REPO:$tag already points at $existing; use base-image-approval.yml" >&2
  exit 1
fi

approved_ref="$GHCR_APPROVED_REPO@$digest"
copy_exact "$upstream_digest_ref" "$GHCR_APPROVED_REPO" "bootstrap-${digest#sha256:}" "$digest" reports/approved.digest
crane manifest "$approved_ref" > reports/bootstrap-index.json
policy_version="$(python3 -I scripts/policy_info.py --field version)"
python3 - "$policy_version" "$upstream_ref" "$digest" "$GITHUB_SHA" <<'PY'
import json, pathlib, sys
version, upstream_ref, digest, git_sha = sys.argv[1:]
reason = ('First baseline: imported WITHOUT comparison (nothing to compare with) after a human '
          'review of the bootstrap run. Comparison baseline only; not consumable by applications.')
decision = {'decision': 'REVIEW', 'policy_version': version, 'bootstrap': True,
            'upstream_signature': 'not_verified', 'upstream_provenance': 'not_verified',
            'review_reasons': [reason]}
pathlib.Path('reports/decision.json').write_text(json.dumps(decision, indent=2, sort_keys=True) + '\n')
context = {'upstream_ref': upstream_ref, 'digest': digest, 'git_sha': git_sha, 'bootstrap': True}
pathlib.Path('reports/context.json').write_text(json.dumps(context, indent=2, sort_keys=True) + '\n')
PY
python3 -I scripts/approval_record.py --bootstrap --decision-file reports/decision.json --evidence-dir reports \
  --upstream-ref "$upstream_ref" --approved-ref "$approved_ref" \
  --approver "$APPROVER_ID" --build-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
  --git-commit "$GITHUB_SHA" --predicate-type "$APPROVAL_PREDICATE_TYPE" \
  --output reports/approval-attestation.json
cosign sign "${COSIGN_SIGN_FLAGS[@]}" --key "$COSIGN_KEY" "$approved_ref"
cosign attest "${COSIGN_SIGN_FLAGS[@]}" --key "$COSIGN_KEY" \
  --type "$APPROVAL_PREDICATE_TYPE" --predicate reports/approval-attestation.json "$approved_ref"
cosign verify --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" "$approved_ref" >/dev/null
cosign verify-attestation --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" --type "$APPROVAL_PREDICATE_TYPE" \
  "$approved_ref" > reports/bootstrap-attestation-verified.json
# Usable as the comparison baseline ...
python3 -I scripts/check_approval_attestation.py reports/bootstrap-attestation-verified.json \
  --predicate-type "$APPROVAL_PREDICATE_TYPE" --digest "$digest" --expected-ref "$approved_ref" \
  --accepted-policy-versions "$(python3 -I scripts/policy_info.py --field historical_baseline_versions)" \
  --max-age-hours "$(python3 -I scripts/policy_info.py --field historical_baseline_max_age_hours)"
# ... and NOT as a consumable approval: the current fingerprint must be missing.
if python3 -I scripts/check_approval_attestation.py reports/bootstrap-attestation-verified.json \
     --predicate-type "$APPROVAL_PREDICATE_TYPE" --digest "$digest" --expected-ref "$approved_ref" \
     --accepted-policy-versions "$policy_version" \
     --expected-policy-sha256 "$(python3 -I scripts/policy_info.py --field policy_sha256)" >/dev/null 2>&1; then
  echo 'Bootstrap record would be consumable by applications; refusing to publish the tracking tag' >&2
  exit 1
fi
crane tag "$approved_ref" "$tag"
[[ "$(crane digest "$GHCR_APPROVED_REPO:$tag")" = "$digest" ]] || exit 1
printf '%s\n' "$approved_ref" > reports/approved-ref.txt
echo "Bootstrapped $approved_ref (comparison baseline only); now run base-image-approval.yml"
