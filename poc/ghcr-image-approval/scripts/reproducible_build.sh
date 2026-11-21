#!/usr/bin/env bash
# Reproducible application image build, shared by BOTH isolated builders so they run the
# exact same command. Two honest builds of the same commit + build outputs must produce the
# same image ID; the publisher refuses to sign otherwise.
#
# Usage: reproducible_build.sh CONTEXT_DIR DOCKERFILE IMAGE_NAME SOURCE_DATE_EPOCH EVIDENCE_DIR
# Writes EVIDENCE_DIR/image-id.txt and EVIDENCE_DIR/builder-versions.txt.
#
# Why these flags (verified on Docker 29.9.3 / buildx 0.38.1 with the containerd image store):
#   * SOURCE_DATE_EPOCH alone fixes the config timestamps and WORKDIR, but COPY gives parent
#     directories the wall-clock mtime            -> rewrite-timestamp=true clamps all mtimes
#   * buildx attaches a provenance attestation by default that records build details such
#     as the context path, changing the image ID    -> --provenance=false --sbom=false
#   * `--builder <current context>` uses the docker-driver builder of the daemon the CLI talks
#     to, so the image lands in that daemon's image store (a docker-container builder would
#     export elsewhere). PoC fix: the kit named `default`, but docker/setup-docker-action
#     switches to its own context, and buildx (>= 0.11) refuses a builder named after a context
#     that is not the current one ("use `docker --context=default buildx` ...").
# Both builders need the same Docker/BuildKit versions and the containerd image store.
# RUN steps that write timestamps or random data into files still make builds differ: fix
# those Dockerfiles; this script will not hide it.
set -Eeuo pipefail
context="${1:?context dir}"
dockerfile="${2:?Dockerfile}"
image="${3:?image name}"
epoch="${4:?SOURCE_DATE_EPOCH}"
out="${5:?evidence dir}"
if ! [[ "$epoch" =~ ^[0-9]{1,12}$ ]]; then
  echo "SOURCE_DATE_EPOCH must be a Unix timestamp, got '$epoch'" >&2
  exit 1
fi
mkdir -p "$out"

driver_status="$(docker info --format '{{json .DriverStatus}}')"
case "$driver_status" in
  *io.containerd.snapshotter*) ;;
  *)
    echo "The containerd image store is required for reproducible image IDs (DriverStatus: $driver_status)" >&2
    exit 1
    ;;
esac
builder="$(docker context inspect --format '{{.Name}}')"
[[ -n "$builder" ]] || { echo 'Could not determine the current docker context' >&2; exit 1; }
{
  docker version --format 'docker-server={{.Server.Version}}'
  printf 'buildx=%s\n' "$(docker buildx version)"
  printf 'image-store=%s\n' "$driver_status"
  printf 'builder=%s\n' "$builder"
} > "$out/builder-versions.txt"

docker buildx build --builder "$builder" --pull --no-cache --network=none \
  --provenance=false --sbom=false \
  --build-arg "SOURCE_DATE_EPOCH=$epoch" \
  --output "type=image,name=$image,rewrite-timestamp=true" \
  -f "$dockerfile" "$context"

docker image inspect --format '{{.Id}}' "$image" > "$out/image-id.txt"
grep -Eq '^sha256:[a-f0-9]{64}$' "$out/image-id.txt"
echo "Built $image: $(cat "$out/image-id.txt")"
