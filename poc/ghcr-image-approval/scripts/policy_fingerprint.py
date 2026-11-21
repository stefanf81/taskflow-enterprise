#!/usr/bin/env python3
"""Fingerprint the code and settings that decide a BASE-IMAGE approval.

What it is for (and only that): ci/base_precheck.sh skips an upstream digest that is already
approved. With the fingerprint in the signed approval record, that skip also requires that
the approval was produced by exactly today's base-evaluation code, settings and tool pins. A
change to any of them makes the precheck answer "needed", and the normal pipeline evaluates
the same digest again and signs a fresh record - no manual bootstrap.

Comparison baseline migration: evaluate/promote may accept historical approval versions
from `historical_baseline_policy_versions` as references to calculate an image diff. Those
historical approvals are NOT permitted by the base verification helper for new application
builds. Application consumption also requires the currently trusted policy fingerprint.
The precheck likewise requires that current fingerprint before skipping an update.

Covered:
  * BASE_FILES - the base workflow, the scripts it runs, the tool installer and its lock.
    tests/test_v5_fixes.py checks this list is closed under "one file references another".
  * the base view of policy/config.json: everything except application-only settings
    (`verification_max_age_minutes`, and exceptions that cannot match a base candidate:
    entries without `image_ref`, or whose `image_ref` is an application repository).
Not covered: policy/applications.json, the application pipeline and its scripts, the PR
workflow, docs, tests - changing them never asks reviewers to re-approve a base image.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_FILES = (
    '.github/workflows/base-image-approval.yml',
    'ci/base_evaluate.sh',
    'ci/base_precheck.sh',
    'ci/base_promote.sh',
    'ci/base_quarantine.sh',
    'ci/common.sh',
    'ci/environment_approver.py',
    'ci/install_verified_tools.py',
    'ci/require_ghcr_config.sh',
    'ci/require_tools.sh',
    'ci/toolchain.lock.json',
    'scripts/approval_record.py',
    'scripts/check_approval_attestation.py',
    'scripts/compare.sh',
    'scripts/evaluate.py',
    'scripts/inventory_fs.py',
    'scripts/manifest_platforms.py',
    'scripts/parse_from.py',
    'scripts/policy_fingerprint.py',
    'scripts/policy_info.py',
)
POLICY = 'policy/config.json'
APPLICATION_ONLY_KEYS = ('verification_max_age_minutes',)
APPLICATION_REPOSITORY = re.compile(r'^[^/@\s]+/[^/@\s]+/(?:applications|application-candidates)/')


def base_policy_view(config):
    """The part of policy/config.json that can change a base-image decision, canonically encoded."""
    if not isinstance(config, dict):
        raise ValueError('policy config must be a JSON object')
    view = {k: v for k, v in config.items() if k not in APPLICATION_ONLY_KEYS}
    exceptions = view.get('critical_exceptions')
    if isinstance(exceptions, list):
        # Base evaluation matches exceptions by image_ref == the quarantine candidate only.
        # Anything not clearly application-scoped stays in (conservative).
        view['critical_exceptions'] = [
            e for e in exceptions
            if not (isinstance(e, dict) and (
                'image_ref' not in e
                or (isinstance(e['image_ref'], str) and APPLICATION_REPOSITORY.match(e['image_ref']))))]
    return json.dumps(view, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def fingerprint(root=ROOT):
    root = Path(root)
    digest = hashlib.sha256()

    def add(name, data):
        digest.update(len(name).to_bytes(4, 'big'))
        digest.update(name.encode('utf-8'))
        digest.update(len(data).to_bytes(8, 'big'))
        digest.update(data)

    for relative in sorted(BASE_FILES):
        path = root / relative
        if not path.is_file():
            raise ValueError(f'fingerprinted file missing: {relative}')
        add(relative, path.read_bytes())
    try:
        config = json.loads((root / POLICY).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f'cannot read {POLICY}: {exc}')
    add(POLICY + '#base-view', base_policy_view(config))
    return digest.hexdigest()


if __name__ == '__main__':
    print(fingerprint())
