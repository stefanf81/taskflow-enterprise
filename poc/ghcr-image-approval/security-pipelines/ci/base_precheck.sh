#!/usr/bin/env bash
# Read-only: decide whether the pinned upstream digest still needs an approval run.
#
# Prints "approved" when ghcr.io/<ns>/approved/eclipse-temurin:<tag> already points at the
# pinned digest AND that digest carries a valid approval signature + attestation whose policy
# version is still accepted and whose age is within approval_max_age_hours. Otherwise prints
# "needed". A push that only touches policy/, scripts/ or ci/ therefore no longer asks a
# reviewer to re-approve (and re-sign) a digest that is already approved under current policy.
# The current policy version and exact policy hash must match; historical approvals are
# only allowed when evaluating the previous comparison baseline, never for new workloads.
set -Eeuo pipefail
: "${GHCR_HOST:?}" "${GHCR_APPROVED_REPO:?}" "${GHCR_QUARANTINE_REPO:?}" "${APPROVAL_PUBKEY:?}" "${APPROVAL_PREDICATE_TYPE:?}"
bash ci/require_ghcr_config.sh base
mkdir -p reports
tag="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field tag)"
digest="$(python3 -I scripts/parse_from.py catalog/Dockerfile.temurin --field digest)"
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Renovate must pin digest first' >&2; exit 1; }
current="$(crane digest "$GHCR_APPROVED_REPO:$tag")"
[[ "$current" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'No approved baseline (bootstrap first)' >&2; exit 1; }
if [[ "$current" != "$digest" ]]; then
  echo needed
  exit 0
fi
ref="$GHCR_APPROVED_REPO@$digest"
if cosign verify --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" "$ref" > reports/precheck-signature.json \
  && cosign verify-attestation --insecure-ignore-tlog=true --key "$APPROVAL_PUBKEY" --type "$APPROVAL_PREDICATE_TYPE" \
       "$ref" > reports/precheck-attestation.json \
  && python3 -I scripts/check_approval_attestation.py reports/precheck-attestation.json \
       --predicate-type "$APPROVAL_PREDICATE_TYPE" --digest "$digest" --expected-ref "$ref" \
       --accepted-policy-versions "$(python3 -I scripts/policy_info.py --field accepted_versions)" \
       --max-age-hours "$(python3 -I scripts/policy_info.py --field approval_max_age_hours)" \
       --expected-policy-sha256 "$(python3 -I scripts/policy_info.py --field policy_sha256)" >&2; then
  echo approved
else
  # Same digest but no valid current approval: evaluate again (evaluate verifies the
  # baseline itself and fails closed if the existing approval is invalid).
  echo needed
fi
