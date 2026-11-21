#!/usr/bin/env bash
# Shared by ci/base_quarantine.sh, ci/base_promote.sh and ci/application_pipeline.sh (source it).

# Key-based cosign signing without a transparency log, for cosign v3 (pinned in
# ci/toolchain.lock.json). cosign v3 refuses `--tlog-upload=false` unless the default
# signing config is switched off as well; v4 of this package passed only --tlog-upload=false,
# so every `cosign sign` / `cosign attest` failed. Both flags are needed, in ONE place.
# Verified with cosign v3.1.4: sign, attest, verify and verify-attestation
# (--insecure-ignore-tlog=true --key ...) all work with these flags.
# cosign v3 stores the result in its new bundle format (tag sha256-<digest> on registries
# without the OCI referrers API). Test your Kyverno version against that format.
# shellcheck disable=SC2034  # used by the scripts that source this file
COSIGN_SIGN_FLAGS=(--yes --use-signing-config=false --tlog-upload=false)

# copy_exact SOURCE_REF DEST_REPO TAG EXPECTED_DIGEST DIGEST_FILE
# Copy an image or a whole multi-platform index with the pinned crane (no skopeo: it has no
# release binaries to pin). crane copies manifests byte for byte, so digests are preserved.
# The copy is then verified from the destination's own bytes, not from a registry header.
copy_exact() {
  local source="$1" repo="$2" tag="$3" expected="$4" digest_file="$5" actual
  [[ "$expected" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'copy_exact: invalid expected digest' >&2; return 1; }
  crane copy "$source" "$repo:$tag" >/dev/null
  actual="sha256:$(crane manifest "$repo@$expected" | sha256sum | cut -d' ' -f1)"
  printf '%s\n' "$actual" > "$digest_file"
  [[ "$actual" = "$expected" ]] || { echo "copy_exact: $repo@$expected has manifest bytes hashing to $actual" >&2; return 1; }
  [[ "$(crane digest "$repo:$tag")" = "$expected" ]] || { echo "copy_exact: tag $repo:$tag does not point at $expected" >&2; return 1; }
}
