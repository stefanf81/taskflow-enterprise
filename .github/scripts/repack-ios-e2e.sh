#!/usr/bin/env bash
# JavaScript-only rebuild of the Detox release app (ios-e2e job).
#
# The native part of the .app only changes with the native fingerprint, so CI
# caches the built simulator app per fingerprint and, on a hit, re-bundles
# this commit's JavaScript into it instead of running `pod install` and
# xcodebuild. It runs the app target's own "Bundle React Native code and
# images" build phase (taken from the generated project, so it stays what
# Xcode runs) with the build settings that phase reads. iOS copies the JS
# assets into the bundle as plain files, so no resource compilation is
# skipped. The app is re-signed ad hoc, as Xcode signs simulator builds.
#
# Run from mobile/ after `expo prebuild --platform ios` and with
# ios/.xcode.env.local in place:
#   repack-ios-e2e.sh <path/to/TaskFlowMobile.app>
set -euo pipefail

app="$(cd "$1" && pwd)"
phase="$(plutil -convert json -o - ios/*.xcodeproj/project.pbxproj \
  | jq -r '.objects[] | select(.isa == "PBXShellScriptBuildPhase" and .name == "Bundle React Native code and images") | .shellScript')"
if [[ -z "$phase" ]]; then
  echo "::error::No 'Bundle React Native code and images' phase in the generated project" >&2
  exit 1
fi

release_env=()
while IFS= read -r assignment; do release_env+=("$assignment"); done < <(
  node -e "for (const [k, v] of Object.entries(require('./e2e/release-bundle-env'))) console.log(k + '=' + v)")

# The phase writes main.jsbundle and assets/ into the app; drop the old ones
# so no asset of a previous commit survives.
rm -rf "$app/assets" "$app/main.jsbundle"
env "${release_env[@]}" \
  CONFIGURATION=Release \
  PLATFORM_NAME=iphonesimulator \
  CONFIGURATION_BUILD_DIR="$(dirname "$app")" \
  UNLOCALIZED_RESOURCES_FOLDER_PATH="$(basename "$app")" \
  PROJECT_DIR="$PWD/ios" \
  SRCROOT="$PWD/ios" \
  bash -c "$phase"

if codesign -d "$app" 2>/dev/null; then
  codesign --force --sign - --preserve-metadata=identifier,entitlements,flags "$app"
else
  codesign --force --sign - "$app"
fi
