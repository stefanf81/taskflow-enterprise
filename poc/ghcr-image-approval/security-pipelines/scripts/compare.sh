#!/usr/bin/env bash
# Compare the trusted baseline and the quarantined candidate on every platform.
# Required environment: OLD_REF, CANDIDATE_REF, PLATFORMS (comma-separated), REPORT_DIR.
# Never runs image contents: all tools read registry blobs / tar streams only.
set -Eeuo pipefail
: "${OLD_REF:?}" "${CANDIDATE_REF:?}" "${PLATFORMS:?}" "${REPORT_DIR:?}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Strict format: os/arch[/variant] entries, comma-separated, no empty entries.
platform_re='^[a-z0-9]+/[a-z0-9_]+(/[a-z0-9]+)?(,[a-z0-9]+/[a-z0-9_]+(/[a-z0-9]+)?)*$'
if ! [[ "$PLATFORMS" =~ $platform_re ]]; then
  echo "Invalid PLATFORMS='$PLATFORMS'" >&2
  exit 1
fi
mkdir -p "$REPORT_DIR"
IFS=',' read -ra platforms <<< "$PLATFORMS"

for platform in "${platforms[@]}"; do
  suffix="${platform//\//-}"
  printf '\n===== Comparing %s =====\n' "$platform"

  crane config --platform "$platform" "$OLD_REF" > "$REPORT_DIR/old-$suffix.config.json"
  crane config --platform "$platform" "$CANDIDATE_REF" > "$REPORT_DIR/candidate-$suffix.config.json"

  # Both scans read OCI registry images pinned by digest. Do not run the image.
  syft scan --from registry --platform "$platform" "$OLD_REF" \
    -o "syft-json=$REPORT_DIR/old-$suffix.syft.json"
  syft scan --from registry --platform "$platform" "$CANDIDATE_REF" \
    -o "syft-json=$REPORT_DIR/candidate-$suffix.syft.json"
  grype "sbom:$REPORT_DIR/old-$suffix.syft.json" -o json > "$REPORT_DIR/old-$suffix.grype.json"
  grype "sbom:$REPORT_DIR/candidate-$suffix.syft.json" -o json > "$REPORT_DIR/candidate-$suffix.grype.json"

  # Layer-aware human report; not parsed into a verdict.
  # diffoci (checked with v0.1.8) exits 0 when identical and 1 BOTH when it found differences
  # and when it failed (pull error, bad credentials: logrus "level=fatal"). The exit code alone
  # cannot tell these apart, so a run with exit 1 only counts as "differences found" when it
  # printed a difference table and logged no fatal error. Otherwise the reviewer would get an
  # empty diff report without anyone noticing.
  rc=0
  diffoci --backend=local diff --semantic --platform "$platform" "$OLD_REF" "$CANDIDATE_REF" \
    > "$REPORT_DIR/diffoci-$suffix.txt" 2> "$REPORT_DIR/diffoci-$suffix.stderr.txt" || rc=$?
  if [ "$rc" -gt 1 ] || grep -q 'level=fatal' "$REPORT_DIR/diffoci-$suffix.stderr.txt" \
     || { [ "$rc" -eq 1 ] && [ ! -s "$REPORT_DIR/diffoci-$suffix.txt" ]; }; then
    echo "diffoci failed for $platform (exit $rc); see diffoci-$suffix.stderr.txt" >&2
    tail -n 3 "$REPORT_DIR/diffoci-$suffix.stderr.txt" >&2 || true
    exit 1
  fi

  # Flattened filesystem inventory from tar streams; code never executes image contents.
  crane export --platform "$platform" "$OLD_REF" - \
    | python3 -I "$SCRIPT_DIR/inventory_fs.py" "$REPORT_DIR/old-$suffix.fs.json"
  crane export --platform "$platform" "$CANDIDATE_REF" - \
    | python3 -I "$SCRIPT_DIR/inventory_fs.py" "$REPORT_DIR/candidate-$suffix.fs.json"
done
