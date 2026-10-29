#!/usr/bin/env bash
# JavaScript-only rebuild of the Detox release APK (android-e2e job).
#
# The native part of the APK only changes with the native fingerprint, so CI
# caches the built APKs per fingerprint and, on a hit, swaps in this commit's
# JavaScript bundle instead of running the ~5 min Gradle build. The bundle is
# made exactly like React Native's Gradle task (BundleHermesCTask: Expo CLI
# `export:embed`, then hermesc with the default `-O -output-source-map`).
# Image and font assets are not swapped: Gradle compiles them into the APK's
# resources, so `bundle` records them and the caller rebuilds natively when
# they differ from the cached APK's.
#
# Run from mobile/:
#   repack-android-e2e.sh bundle <out-dir>         bundle + assets, <out-dir>/res.sha256
#   repack-android-e2e.sh res-manifest <res-dir>   checksum list of an assets directory
#   repack-android-e2e.sh apk <apk> <bundle-file>  swap the bundle in, align and re-sign
set -euo pipefail

res_manifest() {
  (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)
}

build_tool() {
  local dir
  dir="$(find "${ANDROID_HOME}/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
  printf '%s/%s\n' "$dir" "$1"
}

case "${1:-}" in
  bundle)
    out="$2"
    mkdir -p "$out/res"
    entry="$(node -e "require('expo/scripts/resolveAppEntry')" "$PWD" android absolute | tail -n 1)"
    cli="$(node --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
    hermes_dir="$(dirname "$(node --print "require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] })")")"
    release_env=()
    while IFS= read -r assignment; do release_env+=("$assignment"); done < <(
      node -e "for (const [k, v] of Object.entries(require('./e2e/release-bundle-env'))) console.log(k + '=' + v)")

    env "${release_env[@]}" node "$cli" export:embed --platform android --dev false --reset-cache \
      --entry-file "$entry" --bundle-output "$out/index.android.bundle.js" --assets-dest "$out/res" \
      --sourcemap-output "$out/index.android.bundle.packager.map" --minify false
    "$hermes_dir/hermesc/linux64-bin/hermesc" -w -emit-binary -max-diagnostic-width=80 \
      -out "$out/index.android.bundle" "$out/index.android.bundle.js" -O -output-source-map
    res_manifest "$out/res" > "$out/res.sha256"
    ;;
  res-manifest)
    res_manifest "$2"
    ;;
  apk)
    apk="$2"
    bundle="$3"
    unsigned="$(mktemp -d)/unsigned.apk"
    # Same entries, order and compression; only the bundle changes. The old
    # v1 signature files go too: apksigner writes a fresh signature.
    python3 -I - "$apk" "$bundle" "$unsigned" <<'PY'
import re, sys, zipfile
src, bundle, dst = sys.argv[1:]
with open(bundle, 'rb') as f:
    data = f.read()
signature = re.compile(r'^META-INF/([^/]+\.(SF|RSA|DSA|EC)|MANIFEST\.MF)$')
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w') as zout:
    for info in zin.infolist():
        if signature.match(info.filename):
            continue
        payload = data if info.filename == 'assets/index.android.bundle' else zin.read(info)
        out = zipfile.ZipInfo(info.filename, info.date_time)
        out.compress_type = info.compress_type
        out.external_attr = info.external_attr
        zout.writestr(out, payload)
PY
    "$(build_tool zipalign)" -P 16 -f 4 "$unsigned" "$apk"
    # The keystore and credentials Expo's template signs release builds with.
    "$(build_tool apksigner)" sign --ks android/app/debug.keystore --ks-pass pass:android \
      --ks-key-alias androiddebugkey --key-pass pass:android "$apk"
    ;;
  *)
    echo "usage: $0 bundle <out-dir> | res-manifest <res-dir> | apk <apk> <bundle-file>" >&2
    exit 2
    ;;
esac
