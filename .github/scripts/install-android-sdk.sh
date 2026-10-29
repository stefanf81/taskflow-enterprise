#!/usr/bin/env bash
# Android SDK packages the native builds need on top of the runner image's:
# the compile SDK, build tools and the NDK version React Native pins.
set -euo pipefail
SDKMANAGER="${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "${SDKMANAGER}" ]]; then
  SDKMANAGER="$(command -v sdkmanager)"
fi

set +o pipefail
yes | "${SDKMANAGER}" --licenses >/dev/null
set -o pipefail
"${SDKMANAGER}" --install \
  'platforms;android-37.0' \
  'build-tools;37.0.0' \
  'ndk;27.1.12297006'
