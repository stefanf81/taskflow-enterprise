#!/usr/bin/env bash
# Central trusted workflow commands for GitHub Actions.
# Runs from a protected security-repository checkout. The application source arrives as the
# hash-checked `git archive` made by the authorize job (ci/source_archive.py) and is
# extracted into ./application; no job after authorize holds an application read token.
set -Eeuo pipefail
: "${APP_COMMIT:?}" "${APP_NAME:?}" \
  "${GHCR_HOST:?}" "${APP_CANDIDATE_REPO:?}" "${APP_RELEASE_REPO:?}" \
  "${APPROVED_PREFIX:?}" "${APPROVAL_PREDICATE_TYPE:?}"
bash ci/require_ghcr_config.sh app
# shellcheck source=ci/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# Source repository, Dockerfile and build outputs come ONLY from the protected allowlist.
APP_SOURCE_REPO="$(python3 -I ci/app_config.py --name "$APP_NAME" --field source_repo)"
APP_DOCKERFILE="$(python3 -I ci/app_config.py --name "$APP_NAME" --field dockerfile)"
APP_BUILD_OUTPUTS="$(python3 -I ci/app_config.py --name "$APP_NAME" --field build_outputs)"
# PoC: the application's folder inside its source repository ('.' = the root, as in the kit).
APP_DIR="$(python3 -I ci/app_config.py --name "$APP_NAME" --field directory)"
[[ "$APP_DIR" =~ ^[A-Za-z0-9_./-]+$ && "$APP_DIR" != /* && "$APP_DIR" != *..* ]] || exit 1
APP_ROOT="application/$APP_DIR"
[[ "$APP_COMMIT" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected full 40-character SHA1 commit' >&2; exit 1; }
[[ "$APP_SOURCE_REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || exit 1
[[ "$APP_DOCKERFILE" =~ ^[A-Za-z0-9_./-]+$ && "$APP_DOCKERFILE" != /* && "$APP_DOCKERFILE" != *../* ]] || exit 1
APP_TAG="$APP_COMMIT"
LOCAL_IMAGE="local-application:$APP_COMMIT"
SOURCE_REPOSITORY="https://github.com/$APP_SOURCE_REPO.git"
WORKFLOW_PATH="$GITHUB_REPOSITORY/.github/workflows/application-release.yml"
# Files each image builder GitHub-attests (finding v2-8: the base lists are attested too).
ATTESTED_EVIDENCE=(image-evidence/config-digest.txt image-evidence/base-images.txt image-evidence/final-base.txt)
export APP_TAG LOCAL_IMAGE SOURCE_REPOSITORY

extract_source() {
  : "${SOURCE_SHA256:?}"
  python3 -I ci/source_archive.py extract --archive source/source.tar --sha256 "$SOURCE_SHA256" --dest application
}

app_build() {
  : "${SOURCE_DATE_EPOCH:?}" "${BUILD_OUTPUT_TIMESTAMP:?}"
  extract_source
  ( cd "$APP_ROOT" && CI_SKIP_TESTS="${CI_SKIP_TESTS:-0}" ./ci/build_and_test.sh )
  python3 -I scripts/artifact_manifest.py --root "$APP_ROOT" --paths "$APP_BUILD_OUTPUTS" --output manifest.json
  python3 -I ci/pack_outputs.py pack --root "$APP_ROOT" --manifest manifest.json --tar outputs.tar
}

image_build() {
  : "${SOURCE_DATE_EPOCH:?}"
  [[ "$SOURCE_DATE_EPOCH" =~ ^[0-9]{1,12}$ ]] || exit 1
  test -f compiled/manifest.json && test -f other/manifest.json
  cmp compiled/manifest.json other/manifest.json || { echo 'Independent source builds produced different artifacts' >&2; exit 1; }
  extract_source
  python3 -I ci/pack_outputs.py unpack --root "$APP_ROOT" --manifest compiled/manifest.json --tar compiled/outputs.tar
  mkdir -p image-evidence
  python3 -I scripts/check_dockerfile_bases.py "$APP_ROOT/$APP_DOCKERFILE" \
    --approved-prefix "$APPROVED_PREFIX" \
    --final-base-output image-evidence/final-base.txt > image-evidence/base-images.txt
  bash scripts/verify_bases.sh image-evidence/base-images.txt image-evidence
  bash scripts/reproducible_build.sh "$APP_ROOT" "$APP_ROOT/$APP_DOCKERFILE" \
    "$LOCAL_IMAGE" "$SOURCE_DATE_EPOCH" image-evidence
  docker save -o application-image.tar "$LOCAL_IMAGE"
  (sha256sum application-image.tar > application-image.tar.sha256)
  # Attested identity = the CONFIG digest read from the saved archive. Not `.Id`: with the
  # containerd image store that is the OCI manifest digest (v2 compared it with the registry
  # config digest, which can never match).
  python3 -I ci/image_tar_identity.py application-image.tar --expected-repotag "$LOCAL_IMAGE" \
    --output image-evidence/config-digest.txt
}

require_attestation_cli() {
  command -v gh >/dev/null
  # gh attestation --signer-workflow verification had vulnerabilities in old releases;
  # do NOT silently accept an outdated GitHub CLI.
  local version
  version="$(gh --version | head -n1 | sed -E 's/^gh version ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
  python3 - "$version" <<'PY'
import sys
try: parts=tuple(map(int,sys.argv[1].split('.')))
except ValueError: raise SystemExit('could not parse gh version')
if parts < (2,97,0): raise SystemExit('gh >= 2.97.0 required to verify signer-workflow safely')
PY
}

verify_attested() {
  gh attestation verify "$1" --repo "$GITHUB_REPOSITORY" --signer-workflow "$WORKFLOW_PATH" \
    --source-ref refs/heads/main --format json > /dev/null
}

check_builder_output() {
  local folder="$1" file
  (cd "$folder" && sha256sum -c application-image.tar.sha256)
  verify_attested "$folder/application-image.tar"
  for file in "${ATTESTED_EVIDENCE[@]}"; do verify_attested "$folder/$file"; done
  # The archive must hold exactly our one image (no extra RepoTags) and its config must be
  # the one the builder attested.
  [[ "$(python3 -I ci/image_tar_identity.py "$folder/application-image.tar" --expected-repotag "$LOCAL_IMAGE")" \
     = "$(cat "$folder/image-evidence/config-digest.txt")" ]] || { echo "$folder: archive config differs from attested config" >&2; exit 1; }
}

# READ-ONLY job: everything that parses the untrusted image runs here, without a write token.
scan() {
  require_attestation_cli
  mkdir -p publish-evidence
  cmp compiled-a/manifest.json compiled-b/manifest.json
  check_builder_output image-a
  check_builder_output image-b
  # Both identity() calls above stream and authenticate every actual archive layer.
  # Also assert their ordered layer digests match, rather than trusting config alone.
  python3 -I ci/image_tar_identity.py image-a/application-image.tar --field diff_ids > image-a/verified-diff-ids.json
  python3 -I ci/image_tar_identity.py image-b/application-image.tar --field diff_ids > image-b/verified-diff-ids.json
  cmp image-a/verified-diff-ids.json image-b/verified-diff-ids.json || {
    echo 'Independent builder archives have different verified layer sequences' >&2; exit 1; }
  local file
  for file in "${ATTESTED_EVIDENCE[@]}"; do
    cmp "image-a/$file" "image-b/$file" || { echo "Independent builders disagree on $file; refuse release." >&2; exit 1; }
  done
  local tar=image-a/application-image.tar config platform expected
  config="$(cat image-a/image-evidence/config-digest.txt)"
  cp image-a/image-evidence/config-digest.txt publish-evidence/config-digest.txt
  cut -d' ' -f1 image-a/application-image.tar.sha256 > publish-evidence/application-image.sha256
  cp image-a/image-evidence/base-images.txt publish-evidence/base-images.txt
  cp image-a/image-evidence/final-base.txt publish-evidence/final-base.txt
  bash scripts/verify_bases.sh publish-evidence/base-images.txt publish-evidence
  platform="$(python3 -I ci/image_tar_identity.py "$tar" --field platform)"
  echo "$platform" > publish-evidence/platform.txt
  python3 -I ci/image_tar_identity.py "$tar" --field diff_ids > publish-evidence/image-layers.json
  crane config --platform "$platform" "$(cat publish-evidence/final-base.txt)" > publish-evidence/final-base-config.json
  python3 -I scripts/check_layer_prefix.py \
    --image-layers publish-evidence/image-layers.json --base-config publish-evidence/final-base-config.json
  python3 -I ci/check_additive_layers.py "$tar" --base-config publish-evidence/final-base-config.json \
    --output publish-evidence/layer-overlay.json
  syft scan "docker-archive:$tar" -o cyclonedx-json=publish-evidence/app-sbom.json
  grype "docker-archive:$tar" -o json > publish-evidence/application-grype.json
  # The digest crane push WILL produce for this archive; the push job must reproduce it exactly.
  expected="$(crane digest --tarball "$tar")"
  [[ "$expected" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
  printf '%s\n' "$APP_CANDIDATE_REPO@$expected" > publish-evidence/pushed-ref.txt
  python3 -I scripts/check_application_vulnerabilities.py \
    publish-evidence/application-grype.json --report publish-evidence/vulnerability-decision.json \
    --policy policy/config.json --image-ref "$APP_CANDIDATE_REPO@$expected" \
    --release-ref "$APP_RELEASE_REPO@$expected" --platform "$platform" \
    --final-base "$(cat publish-evidence/final-base.txt)" \
    --base-config publish-evidence/final-base-config.json \
    --layer-overlay publish-evidence/layer-overlay.json --image-config-digest "$config" --allow-review
  cp compiled-a/manifest.json manifest.json
  sha256sum manifest.json | cut -d' ' -f1 > publish-evidence/artifact-manifest-sha256.txt
  python3 -I scripts/validate_publish_evidence.py --directory publish-evidence \
    --expected-repository "$APP_CANDIDATE_REPO" --expected-tag "$APP_TAG" \
    --artifact-manifest manifest.json --release-repository "$APP_RELEASE_REPO"
}

# WRITE job: no scanner, no docker daemon. Pushes the attested archive the scan job approved.
push_candidate() {
  require_attestation_cli
  local tar=image-a/application-image.tar expected pushed
  verify_attested "$tar"
  [[ "$(sha256sum "$tar" | cut -d' ' -f1)" = "$(cat publish-evidence/application-image.sha256)" ]] || {
    echo 'Archive differs from the one the scan job scanned' >&2; exit 1; }
  [[ "$(python3 -I ci/image_tar_identity.py "$tar" --expected-repotag "$LOCAL_IMAGE")" \
     = "$(cat publish-evidence/config-digest.txt)" ]] || exit 1
  expected="$(cat publish-evidence/pushed-ref.txt)"
  [[ "$expected" =~ ^"$APP_CANDIDATE_REPO"@sha256:[a-f0-9]{64}$ ]] || exit 1
  # Take the digest from the push itself (not a later tag lookup that another push could race).
  crane push "$tar" "$APP_CANDIDATE_REPO:$APP_TAG" --image-refs publish-evidence/push-image-refs.txt
  pushed="$(head -n1 publish-evidence/push-image-refs.txt)"
  [[ "$pushed" = "$expected" ]] || { echo "Pushed $pushed, but the scan approved $expected" >&2; exit 1; }
  crane manifest "$expected" > publish-evidence/pushed-candidate-manifest.json
  python3 -I ci/check_registry_config.py publish-evidence/pushed-candidate-manifest.json \
    publish-evidence/config-digest.txt publish-evidence/config-digest.txt >/dev/null
}

promote_image() {
  python3 -I scripts/validate_publish_evidence.py --directory publish-evidence \
    --expected-repository "$APP_CANDIDATE_REPO" --expected-tag "$APP_TAG" \
    --artifact-manifest manifest.json --release-repository "$APP_RELEASE_REPO"
  local decision candidate digest
  decision="$(python3 -c 'import json; print(json.load(open("publish-evidence/vulnerability-decision.json"))["decision"])')"
  case "$decision" in
    REVIEW) [[ -n "${APP_HIGH_APPROVER:-}" ]] || exit 1 ;;
    PASS) [[ -z "${APP_HIGH_APPROVER:-}" ]] || exit 1 ;;
    *) echo "No promotion for decision $decision" >&2; exit 1 ;;
  esac
  candidate="$(cat publish-evidence/pushed-ref.txt)"; digest="${candidate##*@}"
  [[ "$(crane digest "$candidate")" = "$digest" ]] || exit 1
  # Both builders' CONFIG digests were GitHub-attestation-verified in this job.
  # The registry manifest MUST name exactly that config.
  crane manifest "$candidate" > publish-evidence/verified-candidate-manifest.json
  python3 -I ci/check_registry_config.py publish-evidence/verified-candidate-manifest.json \
    image-identity-a/config-digest.txt image-identity-b/config-digest.txt > publish-evidence/builder-config-digest.txt
  cmp -s <(tr -d '\n' < publish-evidence/builder-config-digest.txt) <(tr -d '\n' < publish-evidence/config-digest.txt) || exit 1
  # Scanned digest is content copied; GHCR permissions must be explicitly configured; naming alone does not isolate publishers.
  copy_exact "$candidate" "$APP_RELEASE_REPO" "$APP_TAG" "$digest" publish-evidence/promoted.digest
  [[ "$(crane digest "$APP_RELEASE_REPO:$APP_TAG")" = "$digest" ]] || exit 1
  printf '%s\n' "$APP_RELEASE_REPO@$digest" > publish-evidence/approved-ref.txt
  if [[ -n "${APP_HIGH_APPROVER:-}" ]]; then
    python3 - "$APP_HIGH_APPROVER" <<'PY'
import json,sys
r=json.load(open('publish-evidence/vulnerability-decision.json'))
findings=sorted([x['id'],x['package'],x['package_version']] for x in r['high'])
with open('publish-evidence/high-approval.json','w') as f:
    json.dump({'approver':sys.argv[1],'findings':findings},f)
PY
  fi
}

rescan() {
  local image platform base digest
  image="$(cat publish-evidence/approved-ref.txt)"; platform="$(cat publish-evidence/platform.txt)"
  digest="${image##*@}"
  [[ "$(crane digest "$image")" = "$digest" ]] || exit 1
  [[ "$(crane digest "$APP_RELEASE_REPO:$APP_TAG")" = "$digest" ]] || exit 1
  base="$(cat publish-evidence/final-base.txt)"
  crane config --platform "$platform" "$base" > publish-evidence/independent-base-config.json
  # Pull the exact promoted digest and redo the layer analysis on what the registry serves.
  crane pull "$image" "$RUNNER_TEMP/promoted.tar"
  [[ "$(python3 -I ci/image_tar_identity.py "$RUNNER_TEMP/promoted.tar")" = "$(cat publish-evidence/config-digest.txt)" ]] || {
    echo 'Registry image config differs from the attested builder config' >&2; exit 1; }
  python3 -I ci/image_tar_identity.py "$RUNNER_TEMP/promoted.tar" --field diff_ids \
    > publish-evidence/independent-image-layers.json
  python3 -I scripts/check_layer_prefix.py \
    --image-layers publish-evidence/independent-image-layers.json \
    --base-config publish-evidence/independent-base-config.json
  python3 -I ci/check_additive_layers.py "$RUNNER_TEMP/promoted.tar" \
    --base-config publish-evidence/independent-base-config.json \
    --output publish-evidence/independent-layer-overlay.json
  rm -f "$RUNNER_TEMP/promoted.tar"
  grype db update
  grype "registry:$image" --platform "$platform" -o json > publish-evidence/independent-grype.json
}

issue_verifier() {
  : "${VERIFIER_KEY:?}"
  local args=()
  if [[ -f publish-evidence/high-approval.json ]]; then args=(--approved-high publish-evidence/high-approval.json); fi
  python3 -I scripts/independent_scan_attestation.py --issue \
    --image "$(cat publish-evidence/approved-ref.txt)" \
    --platform "$(cat publish-evidence/platform.txt)" --commit "$APP_COMMIT" \
    --base "$(cat publish-evidence/final-base.txt)" \
    --base-config publish-evidence/independent-base-config.json \
    --layer-overlay publish-evidence/independent-layer-overlay.json \
    "${args[@]}" --policy policy/config.json --scan publish-evidence/independent-grype.json \
    --record publish-evidence/independent-verification.json \
    --signature publish-evidence/independent-verification.sig \
    --private-key "$VERIFIER_KEY"
}

final_sign() {
  : "${VERIFIER_PUBKEY:?}" "${RELEASE_GATE_PUBKEY:?}" "${COSIGN_KEY:?}" "${RELEASE_GATE_URL:?}"
  local image digest approver='' max_age
  image="$(cat publish-evidence/approved-ref.txt)"; digest="${image##*@}"
  [[ "$(crane digest "$image")" = "$digest" ]] || exit 1
  [[ "$(crane digest "$APP_RELEASE_REPO:$APP_TAG")" = "$digest" ]] || exit 1
  python3 -I scripts/validate_publish_evidence.py --directory publish-evidence \
    --expected-repository "$APP_CANDIDATE_REPO" --expected-tag "$APP_TAG" \
    --artifact-manifest manifest.json --release-repository "$APP_RELEASE_REPO"
  if [[ -f publish-evidence/high-approval.json ]]; then
    approver="$(python3 -c 'import json; print(json.load(open("publish-evidence/high-approval.json"))["approver"])')"
  fi
  # Freshness window comes from the protected policy (covers waiting for the signing environment).
  max_age="$(python3 -I scripts/policy_info.py --field verification_max_age_minutes)"
  python3 -I scripts/independent_scan_attestation.py --verify \
    --image "$image" --platform "$(cat publish-evidence/platform.txt)" \
    --commit "$APP_COMMIT" --policy policy/config.json --scan publish-evidence/independent-grype.json \
    --record publish-evidence/independent-verification.json \
    --signature publish-evidence/independent-verification.sig \
    --base-config publish-evidence/independent-base-config.json \
    --layer-overlay publish-evidence/independent-layer-overlay.json \
    --expected-high-approver "$approver" --public-key "$VERIFIER_PUBKEY" --max-age-minutes "$max_age"
  mkdir -p release-evidence
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-filesize 1048576 \
    -H 'Cache-Control: no-cache' --output release-evidence/authorization-envelope.json \
    "$RELEASE_GATE_URL/$APP_COMMIT"
  python3 -I scripts/verify_release_authorization.py \
    --envelope release-evidence/authorization-envelope.json --write-record release-evidence/authorization.json \
    --public-key "$RELEASE_GATE_PUBKEY" --expected-commit "$APP_COMMIT" \
    --expected-repository "$SOURCE_REPOSITORY" \
    --expected-schema "${RELEASE_GATE_SCHEMA:?}" --expected-issuer "${RELEASE_GATE_ISSUER:?}" \
    --required-checks "${RELEASE_REQUIRED_CHECKS:?}" --max-issued-age-minutes 10
  python3 -I scripts/create_application_build_record.py --directory publish-evidence \
    --app-commit "$APP_COMMIT" --source-repository "$SOURCE_REPOSITORY" \
    --build-job "$WORKFLOW_PATH" \
    --release-repository "$APP_RELEASE_REPO" --candidate-repository "$APP_CANDIDATE_REPO" \
    --schema "$BUILD_RECORD_PREDICATE_TYPE" --release-authorization release-evidence/authorization.json \
    --artifact-manifest manifest.json --build-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
    --output publish-evidence/application-build-record.json
  cosign sign "${COSIGN_SIGN_FLAGS[@]}" --key "$COSIGN_KEY" "$image"
  cosign attest "${COSIGN_SIGN_FLAGS[@]}" --key "$COSIGN_KEY" --type cyclonedx \
    --predicate publish-evidence/app-sbom.json "$image"
  cosign attest "${COSIGN_SIGN_FLAGS[@]}" --key "$COSIGN_KEY" \
    --type "$BUILD_RECORD_PREDICATE_TYPE" \
    --predicate publish-evidence/application-build-record.json "$image"
  cosign verify --insecure-ignore-tlog=true --key "${COSIGN_PUBKEY:?}" "$image" >/dev/null
  cosign verify-attestation --insecure-ignore-tlog=true --key "$COSIGN_PUBKEY" --type "$BUILD_RECORD_PREDICATE_TYPE" \
    "$image" > publish-evidence/verified-build-record.json
  python3 -I scripts/check_application_build_record.py \
    --attestations publish-evidence/verified-build-record.json \
    --record publish-evidence/application-build-record.json \
    --predicate-type "$BUILD_RECORD_PREDICATE_TYPE"
}

case "${1:-}" in
 build) app_build ;;
 image) image_build ;;
 scan) scan ;;
 push) push_candidate ;;
 promote) promote_image ;;
 rescan) rescan ;;
 verify) issue_verifier ;;
 sign) final_sign ;;
 *) echo 'Usage: application_pipeline.sh {build|image|scan|push|promote|rescan|verify|sign}' >&2; exit 2 ;;
esac
