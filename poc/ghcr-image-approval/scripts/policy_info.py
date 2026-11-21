#!/usr/bin/env python3
"""Read approval-policy settings that pipelines need, from ONE place: policy/config.json.

  --field version                 current policy version (new approvals are recorded with it)
  --field accepted_versions       application consumption / current precheck only
  --field historical_baseline_versions  historical approvals usable as comparison inputs only
  --field approval_max_age_hours  maximum age of a production-consumable approval
  --field historical_baseline_max_age_hours  max age for comparison baselines only
  --field verification_max_age_minutes
                                  maximum age of the independent verifier's signed record when
                                  the application signer checks it (covers queueing for the
                                  signing environment's approval)
  --field policy_sha256           fingerprint of the base-evaluation code, settings and tool pins
                                  (scripts/policy_fingerprint.py); used only by the precheck

The central trusted CI repository is the only source for these values, so a policy change and
the list of still-accepted older versions change together, in one reviewed commit.
"""
import argparse
import json
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from policy_fingerprint import fingerprint


def info(config):
    version = config.get('version')
    accepted = config.get('accepted_approval_policy_versions')
    historical = config.get('historical_baseline_policy_versions')
    max_age = config.get('approval_max_age_hours')
    if not isinstance(version, str) or not version:
        raise ValueError('policy version missing')
    if not isinstance(accepted, list) or not all(isinstance(v, str) and v for v in accepted):
        raise ValueError('accepted_approval_policy_versions must be a non-empty list of strings')
    if version not in accepted:
        raise ValueError(f'current policy version {version!r} must be in accepted_approval_policy_versions')
    if not isinstance(historical, list) or not historical or not all(isinstance(v, str) and v for v in historical):
        raise ValueError('historical_baseline_policy_versions must be a nonempty list of strings')
    if not set(accepted).issubset(set(historical)):
        raise ValueError('historical_baseline_policy_versions must include all accepted versions')
    if not isinstance(max_age, int) or isinstance(max_age, bool) or max_age <= 0:
        raise ValueError('approval_max_age_hours must be a positive integer')
    baseline_age = config.get('historical_baseline_max_age_hours')
    if not isinstance(baseline_age, int) or isinstance(baseline_age, bool) or baseline_age <= 0:
        raise ValueError('historical_baseline_max_age_hours must be positive')
    verify_age = config.get('verification_max_age_minutes', 10)
    if not isinstance(verify_age, int) or isinstance(verify_age, bool) or not 1 <= verify_age <= 1440:
        raise ValueError('verification_max_age_minutes must be an integer from 1 to 1440')
    return {'version': version, 'accepted_versions': ','.join(accepted),
            'historical_baseline_versions': ','.join(historical),
            'approval_max_age_hours': str(max_age),
            'historical_baseline_max_age_hours': str(baseline_age),
            'verification_max_age_minutes': str(verify_age)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--policy', default='policy/config.json')
    p.add_argument('--field', required=True, choices=['version', 'accepted_versions', 'approval_max_age_hours',
                                                     'verification_max_age_minutes', 'historical_baseline_versions', 'historical_baseline_max_age_hours', 'policy_sha256'])
    args = p.parse_args()
    with open(args.policy, encoding='utf-8') as f:
        config = json.load(f)
    try:
        if args.field == 'policy_sha256':
            print(fingerprint())
        else:
            print(info(config)[args.field])
    except ValueError as e:
        raise SystemExit(f'ERROR: {e}')


if __name__ == '__main__':
    main()
