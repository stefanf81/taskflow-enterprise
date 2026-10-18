#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: puts the repo's Node/npm on
# PATH and installs the npm dependencies so lint and tests work from the start.
#
# - Node comes from mobile/.nvmrc (the base image ships an older Node that the
#   Angular CLI rejects); npm from frontend/package.json "packageManager"
#   (older npm strips the "libc" markers from the lockfiles). Both follow
#   Renovate's bumps of those files.
# - shared/schemas needs its own install: mobile Jest and tsc resolve zod from it.
# - Java 21 and the Gradle wrapper already work in the base image.
set -euo pipefail

# stdout of a SessionStart hook becomes session context; keep the install logs out of it.
exec 1>&2

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

NODE_VERSION="$(tr -d ' \nv' < mobile/.nvmrc)"
NPM_VERSION="$(sed -n 's/.*"packageManager": *"npm@\([^"]*\)".*/\1/p' frontend/package.json)"

case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  *) echo "session-start: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

NODE_DIST="node-v${NODE_VERSION}-linux-${NODE_ARCH}"
NODE_HOME="$HOME/.local/share/taskflow-node/${NODE_DIST}"

if [ ! -x "$NODE_HOME/bin/node" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  base="https://nodejs.org/dist/v${NODE_VERSION}"
  curl -fsSL --retry 3 -o "$tmp/${NODE_DIST}.tar.xz" "$base/${NODE_DIST}.tar.xz"
  curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  (cd "$tmp" && grep " ${NODE_DIST}.tar.xz\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$(dirname "$NODE_HOME")"
  tar -xJf "$tmp/${NODE_DIST}.tar.xz" -C "$tmp"
  rm -rf "$NODE_HOME"
  mv "$tmp/${NODE_DIST}" "$NODE_HOME"
fi

export PATH="$NODE_HOME/bin:$PATH"
echo "export PATH=\"$NODE_HOME/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"

if [ "$(npm -v)" != "$NPM_VERSION" ]; then
  npm install -g --no-audit --no-fund "npm@${NPM_VERSION}"
fi

for dir in . shared/schemas frontend mobile; do
  (cd "$dir" && npm install --no-audit --no-fund)
done
