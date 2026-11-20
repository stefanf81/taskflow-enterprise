#!/usr/bin/env python3
"""Pick the person who approved ONE named environment in this workflow run.

Reads the JSON of `gh api repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/approvals`
on stdin. v2 took the last approval of ANY environment, so an approval given for, say,
the signing environment could be recorded as the High-CVE reviewer. Now:

  * only approvals whose `environments` include --environment count;
  * exactly one distinct approver must remain (several approvals of the same environment
    in one run are ambiguous - fail closed);
  * that approver must be neither --actor (original initiator) nor --triggering-actor
    (the rerun initiator). This
    repeats GitHub's "Prevent self-review" setting in code, so a missing setting does not
    silently allow self-approval.

Prints the approver's login.

PoC (solo maintainer): when the protected policy (policy/config.json) sets
`"allow_self_approval": true`, an approval by the initiator is accepted and printed as
`self:<login>`, so every signed record that carries the approver shows it was a
self-approval. The switch is part of the base policy fingerprint. A missing switch means
strict; an unreadable policy or a non-boolean value is an error, never permission.
"""
import argparse
import json
import pathlib
import re
import sys

LOGIN = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?')
SELF_PREFIX = 'self:'


def self_approval_allowed(policy_path):
    """The `allow_self_approval` switch of the protected policy; absent means strict."""
    config = json.loads(pathlib.Path(policy_path).read_text())
    value = config.get('allow_self_approval', False) if isinstance(config, dict) else None
    if not isinstance(value, bool):
        raise ValueError('allow_self_approval must be true or false')
    return value


def approver(approvals, environment, triggering_actor, actor=None, allow_self=False):
    if not isinstance(approvals, list):
        raise ValueError('approvals API returned an unexpected shape')
    logins = set()
    for item in approvals:
        if not isinstance(item, dict) or item.get('state') != 'approved':
            continue
        envs = item.get('environments')
        if not isinstance(envs, list) or not any(isinstance(e, dict) and e.get('name') == environment for e in envs):
            continue
        login = ((item.get('user') or {}).get('login'))
        if not isinstance(login, str) or not LOGIN.fullmatch(login):
            raise ValueError('approval without a valid user login')
        logins.add(login)
    if not logins:
        raise ValueError(f'no recorded approval for environment {environment!r}')
    if len(logins) != 1:
        raise ValueError(f'several different approvers for {environment!r}: {sorted(logins)}')
    login = logins.pop()
    initiators = {name.lower() for name in (triggering_actor, actor) if name}
    if login.lower() in initiators:
        if allow_self:
            return SELF_PREFIX + login
        raise ValueError(f'{login} started or reran this workflow and cannot approve {environment!r}')
    return login


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--environment', required=True)
    p.add_argument('--triggering-actor', required=True)
    p.add_argument('--actor', required=True, help='original GITHUB_ACTOR')
    p.add_argument('--policy', default='policy/config.json',
                   help='protected policy holding allow_self_approval (default: %(default)s)')
    a = p.parse_args()
    try:
        allow_self = self_approval_allowed(a.policy)
        print(approver(json.load(sys.stdin), a.environment, a.triggering_actor, a.actor, allow_self))
    except (ValueError, OSError, json.JSONDecodeError) as e:
        raise SystemExit(f'NO VALID ENVIRONMENT REVIEWER: {e}')


if __name__ == '__main__':
    main()
