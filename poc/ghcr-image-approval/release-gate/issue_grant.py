#!/usr/bin/env python3
"""Issue one signed release grant for an application commit (PoC release gate).

The central release workflow (stefanf81/ghcr-approval-poc, application-release.yml) fetches
`$RELEASE_GATE_URL/<commit>` at authorization AND again right before signing, and its
scripts/verify_release_authorization.py accepts only a grant that

  * is ONE JSON document {"payloadType", "payload": b64(record), "signature": b64(sig)},
  * is signed with `openssl dgst -sha256 -sign` (RSA or ECDSA key) over the exact record bytes,
  * names the expected schema, repository URL, commit, issuer and decision APPROVED,
  * reports PASS for every check in RELEASE_REQUIRED_CHECKS,
  * was issued at most 10 minutes ago and is valid for at most 24 hours.

This script decides and signs; it does no network I/O. The workflow passes it the
application's current main HEAD and the check-runs of the commit (both from the GitHub API).
It refuses unless the commit IS the main HEAD and every check-run the allowlist requires has
succeeded, and it only trusts check-runs created by GitHub Actions.

Usage: issue_grant.py --repository OWNER/NAME --commit SHA --head-sha SHA
                      --check-runs FILE --allowlist allowlist.json --key KEY.pem --output FILE
                      [--ttl-minutes 15]
"""
import argparse
import base64
import datetime as dt
import json
import pathlib
import re
import subprocess
import tempfile

SHA = re.compile(r'^[0-9a-f]{40}$')
REPOSITORY = re.compile(r'^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$')
PAYLOAD_TYPE = 'application/vnd.example.verified-release+json'
TRUSTED_CHECK_APP = 'github-actions'
MAX_TTL_MINUTES = 60


def load_allowlist(path):
    data = json.loads(pathlib.Path(path).read_text())
    for key in ('issuer', 'record_schema', 'repositories'):
        if key not in data:
            raise ValueError(f'allowlist lacks {key!r}')
    if not isinstance(data['repositories'], dict):
        raise ValueError('allowlist repositories must be an object')
    for name, entry in data['repositories'].items():
        checks = entry.get('checks') if isinstance(entry, dict) else None
        if not REPOSITORY.fullmatch(name) or not isinstance(checks, dict) or not checks or not all(
                isinstance(runs, list) and runs and all(isinstance(r, str) and r for r in runs)
                for runs in checks.values()):
            raise ValueError(f'allowlist entry {name!r} needs checks: {{gate check: [check-run names]}}')
    return data


def evaluate(repository, commit, head_sha, check_runs, allowlist):
    """Return {gate check: 'PASS'} or raise ValueError with the reason for refusing."""
    if not REPOSITORY.fullmatch(repository or ''):
        raise ValueError('repository must be OWNER/NAME')
    if not SHA.fullmatch(commit or ''):
        raise ValueError('commit must be a full lowercase 40-hex SHA')
    entry = allowlist['repositories'].get(repository)
    if entry is None:
        raise ValueError(f'{repository} is not in the gate allowlist')
    if head_sha != commit:
        raise ValueError(f'{commit} is not the main HEAD of {repository} (HEAD is {head_sha})')
    runs = check_runs.get('check_runs') if isinstance(check_runs, dict) else None
    if not isinstance(runs, list):
        raise ValueError('check-runs answer has an unexpected shape')
    if check_runs.get('total_count', len(runs)) > len(runs):
        raise ValueError('more check-runs than one page holds; refusing to judge a partial list')
    result = {}
    for gate_check, names in sorted(entry['checks'].items()):
        for name in names:
            matching = [r for r in runs if isinstance(r, dict) and r.get('name') == name
                        and r.get('head_sha') == commit
                        and (r.get('app') or {}).get('slug') == TRUSTED_CHECK_APP]
            if not matching:
                raise ValueError(f'no GitHub Actions check-run {name!r} for {commit}')
            # Re-runs add check-runs with the same name: the most recent one counts.
            latest = max(matching, key=lambda r: (r.get('started_at') or '', r.get('id') or 0))
            if latest.get('status') != 'completed' or latest.get('conclusion') != 'success':
                raise ValueError(f'check-run {name!r} is {latest.get("status")}/{latest.get("conclusion")}')
        result[gate_check] = 'PASS'
    return result


def record_bytes(repository, commit, checks, allowlist, now, ttl_minutes):
    if not 1 <= ttl_minutes <= MAX_TTL_MINUTES:
        raise ValueError(f'ttl must be 1..{MAX_TTL_MINUTES} minutes')
    stamp = lambda t: t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')  # noqa: E731
    record = {
        'schema': allowlist['record_schema'],
        'repository': f'https://github.com/{repository}.git',
        'commit': commit,
        'issuer': allowlist['issuer'],
        'decision': 'APPROVED',
        'checks': checks,
        'issuedAt': stamp(now),
        'expiresAt': stamp(now + dt.timedelta(minutes=ttl_minutes)),
    }
    return (json.dumps(record, indent=2, sort_keys=True) + '\n').encode()


def sign(data, key_path):
    with tempfile.TemporaryDirectory() as tmp:
        message = pathlib.Path(tmp) / 'record.json'
        message.write_bytes(data)
        result = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key_path), str(message)],
                                capture_output=True)
    if result.returncode != 0 or not result.stdout:
        raise ValueError('signing failed: ' + result.stderr.decode(errors='replace').strip())
    return result.stdout


def envelope(data, signature):
    return json.dumps({'payloadType': PAYLOAD_TYPE,
                       'payload': base64.b64encode(data).decode(),
                       'signature': base64.b64encode(signature).decode()}) + '\n'


def main():
    p = argparse.ArgumentParser()
    for name in ('repository', 'commit', 'head-sha', 'check-runs', 'allowlist', 'key', 'output'):
        p.add_argument('--' + name, required=True)
    p.add_argument('--ttl-minutes', type=int, default=15)
    a = p.parse_args()
    try:
        allowlist = load_allowlist(a.allowlist)
        checks = evaluate(a.repository, a.commit, a.head_sha,
                          json.loads(pathlib.Path(a.check_runs).read_text()), allowlist)
        data = record_bytes(a.repository, a.commit, checks, allowlist,
                            dt.datetime.now(dt.timezone.utc), a.ttl_minutes)
        pathlib.Path(a.output).write_text(envelope(data, sign(data, a.key)))
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f'GRANT REFUSED: {exc}')
    print(f'Granted {a.repository}@{a.commit}: {", ".join(sorted(checks))}')


if __name__ == '__main__':
    main()
