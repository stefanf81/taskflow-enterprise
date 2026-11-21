#!/usr/bin/env bash
# Verify that every base image listed in a file is approved: Cosign signature AND the content
# of the signed approval record (digest, repository, accepted policy version, age, approver).
#
# Usage: verify_bases.sh BASE_LIST_FILE EVIDENCE_DIR
# Environment: APPROVAL_PUBKEY, APPROVAL_PREDICATE_TYPE, optional COSIGN_OFFLINE_VERIFY,
#              optional POLICY_FILE (default: ../policy/config.json next to this script).
# Run only from the TRUSTED central CI checkout, never from an application repository copy.
set -Eeuo pipefail
: "${APPROVAL_PUBKEY:?}" "${APPROVAL_PREDICATE_TYPE:?}"
list="${1:?base list file}"
out="${2:?evidence dir}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
policy="${POLICY_FILE:-$SCRIPT_DIR/../policy/config.json}"
accepted="$(python3 -I "$SCRIPT_DIR/policy_info.py" --policy "$policy" --field accepted_versions)"
max_age="$(python3 -I "$SCRIPT_DIR/policy_info.py" --policy "$policy" --field approval_max_age_hours)"
policy_hash="$(python3 -I "$SCRIPT_DIR/policy_info.py" --policy "$policy" --field policy_sha256)"
mkdir -p "$out"
ref_re='^[a-z0-9.:_/-]+@sha256:[0-9a-f]{64}$'
n=0
while IFS= read -r ref || [ -n "$ref" ]; do
  [ -n "$ref" ] || continue
  if ! [[ "$ref" =~ $ref_re ]]; then
    echo "Invalid base reference: $ref" >&2
    exit 1
  fi
  n=$((n + 1))
  echo "Verifying approval of base image $ref"
  # shellcheck disable=SC2086  # COSIGN_OFFLINE_VERIFY holds zero or more flags
  cosign verify ${COSIGN_OFFLINE_VERIFY:-} --key "$APPROVAL_PUBKEY" "$ref" > "$out/base-$n-signature.json"
  # shellcheck disable=SC2086
  cosign verify-attestation ${COSIGN_OFFLINE_VERIFY:-} --key "$APPROVAL_PUBKEY" \
    --type "$APPROVAL_PREDICATE_TYPE" "$ref" > "$out/base-$n-attestation.json"
  python3 -I "$SCRIPT_DIR/check_approval_attestation.py" "$out/base-$n-attestation.json" \
    --predicate-type "$APPROVAL_PREDICATE_TYPE" --digest "${ref#*@}" --expected-ref "$ref" \
    --accepted-policy-versions "$accepted" --max-age-hours "$max_age" \
    --expected-policy-sha256 "$policy_hash"
done < "$list"
if [ "$n" -eq 0 ]; then
  echo 'No base images to verify' >&2
  exit 1
fi
