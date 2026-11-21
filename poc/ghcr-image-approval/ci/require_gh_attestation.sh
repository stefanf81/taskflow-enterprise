#!/usr/bin/env bash
# GitHub artifact attestation signatures are verified before trusting builder output.
set -Eeuo pipefail
file="${1:?}"
version="$(gh --version | head -n1 | sed -E 's/^gh version ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
python3 - "$version" <<'PY'
import sys
try: version=tuple(map(int,sys.argv[1].split('.')))
except ValueError: raise SystemExit('Cannot parse gh CLI version')
if version < (2,97,0): raise SystemExit('gh 2.97.0+ required for safe --signer-workflow matching')
PY
gh attestation verify "$file" --repo "$GITHUB_REPOSITORY" \
  --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/application-release.yml" \
  --source-ref refs/heads/main --format json >/dev/null
