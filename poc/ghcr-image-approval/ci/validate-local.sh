#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
python3 -m compileall -q scripts ci base-gate release-gate
for f in scripts/*.sh ci/*.sh base-gate/*.sh release-gate/*.sh; do bash -n "$f"; done
python3 - <<'PY'
import json, pathlib
import yaml
root=pathlib.Path('.')
for p in root.rglob('*.json'):
    if p.name.endswith('.example'): continue
    json.loads(p.read_text())
for p in root.rglob('*.yaml'):
    yaml.safe_load(p.read_text())
for p in root.rglob('*.yml'):
    yaml.safe_load(p.read_text())
print('All JSON and YAML parsed')
PY
python3 -m unittest discover -s tests -p 'test_*.py' -v
# PoC: the CI base-image gate and the release gate.
python3 -m unittest discover -s base-gate/tests -v
python3 -m unittest discover -s release-gate/tests -v
