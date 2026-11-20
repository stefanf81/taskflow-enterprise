#!/usr/bin/env python3
"""Validate claims from an already cryptographically verified Cosign DSSE attestation.

ALWAYS feed output of `cosign verify-attestation --key ...` from a TRUSTED agent.
This does NOT itself verify a signature: JSON from an attacker is not evidence.
"""
import argparse
import base64
import datetime as dt
import json
import re
import sys

DIGEST_RE = re.compile(r'^sha256:[a-f0-9]{64}$')
SHA_HEX_RE = re.compile(r'^[a-f0-9]{64}$')
GIT_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
APPROVABLE = ('AUTO_PASS', 'REVIEW')


def statements(text):
    for line in text.splitlines():
        line = line.strip()
        if line:
            env = json.loads(line)
            if env.get('payloadType') not in ('application/vnd.in-toto+json', 'application/vnd.in-toto+json;version=0.1'):
                raise ValueError('Unexpected DSSE payload type')
            yield json.loads(base64.b64decode(env['payload'], validate=True))


def predicate_of(statement):
    predicate = statement.get('predicate') or {}
    if isinstance(predicate.get('Data'), str):
        return json.loads(predicate['Data'])
    return predicate


def problems_with(statement, predicate_type, digest, expected_ref=None, accepted_policy_versions=None,
                  max_age_hours=168, expected_policy_sha256=None):
    problems = []
    if statement.get('predicateType') != predicate_type:
        problems.append('predicate type mismatch')
    predicate = predicate_of(statement)
    if not isinstance(predicate, dict):
        return ['predicate is not a JSON object']
    expected_ref = expected_ref or predicate.get('approved_ref')
    if not expected_ref or not expected_ref.endswith('@' + digest):
        problems.append('expected approved repository/digest mismatch')
    if predicate.get('approved_ref') != expected_ref:
        problems.append('approved_ref is not the exact expected repository/digest')
    repo = expected_ref.rsplit('@', 1)[0] if expected_ref else ''
    if not any(s.get('name') == repo and (s.get('digest') or {}).get('sha256') == digest[7:]
               for s in statement.get('subject', [])):
        problems.append('in-toto subject repository/digest mismatch')
    if predicate.get('schema') != predicate_type:
        problems.append('predicate schema mismatch')
    if accepted_policy_versions and predicate.get('policy_version') not in accepted_policy_versions:
        problems.append(f"policy version {predicate.get('policy_version')!r} not in accepted versions")
    if expected_policy_sha256 is not None and predicate.get('policy_sha256') != expected_policy_sha256:
        problems.append('signed policy content hash does not match current trusted policy')
    if not predicate.get('policy_version'):
        problems.append('missing policy version')
    report_digest = predicate.get('decision_report_sha256')
    evidence = predicate.get('evidence_sha256')
    if not isinstance(report_digest, str) or not SHA_HEX_RE.fullmatch(report_digest):
        problems.append('invalid decision report SHA-256')
    if not isinstance(evidence, dict) or not evidence:
        problems.append('missing evidence binding')
    else:
        if evidence.get('decision.json') != report_digest:
            problems.append('decision.json hash not bound to decision report SHA-256')
        if any(not isinstance(name, str) or not name or name.startswith('/') or '..' in name.split('/') or
               not isinstance(value, str) or not SHA_HEX_RE.fullmatch(value)
               for name, value in evidence.items()):
            problems.append('invalid evidence filenames or SHA-256 values')
    if not isinstance(predicate.get('git_commit'), str) or not GIT_SHA_RE.fullmatch(predicate['git_commit']):
        problems.append('invalid approval Git commit')
    build_url = predicate.get('build_url')
    if not isinstance(build_url, str) or not re.match(r'^https?://[^/\s]+/', build_url):
        problems.append('missing/invalid build/workflow URL')
    decision, approver = predicate.get('decision'), str(predicate.get('approver', '')).strip()
    if decision not in APPROVABLE:
        problems.append('non-approvable decision')
    if decision == 'REVIEW' and approver in ('', 'automatic-policy'):
        problems.append('REVIEW without human approver')
    if decision == 'AUTO_PASS' and approver != 'automatic-policy':
        problems.append('AUTO_PASS without policy identity')
    try:
        timestamp = dt.datetime.fromisoformat(predicate['timestamp_utc'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError('missing UTC offset')
        age = dt.datetime.now(dt.timezone.utc) - timestamp
        if age > dt.timedelta(hours=max_age_hours) or age < dt.timedelta(minutes=-5):
            problems.append('approval timestamp outside permitted freshness window')
    except (KeyError, TypeError, ValueError):
        problems.append('missing/invalid approval timestamp')
    return problems


def check(text, predicate_type, digest, expected_ref=None, accepted_policy_versions=None, max_age_hours=168, expected_policy_sha256=None):
    if isinstance(accepted_policy_versions, str):
        accepted_policy_versions = [v for v in accepted_policy_versions.split(',') if v]
    if not DIGEST_RE.fullmatch(digest):
        raise ValueError(f'Invalid SHA256 digest: {digest!r}')
    if expected_ref and not expected_ref.endswith('@' + digest):
        raise ValueError('expected-ref/digest inconsistent')
    errors = []
    for statement in statements(text):
        problems = problems_with(statement, predicate_type, digest, expected_ref, accepted_policy_versions,
                                 max_age_hours, expected_policy_sha256)
        if not problems:
            return predicate_of(statement)
        errors.append(problems)
    raise ValueError(f'No acceptable signed approval record: {errors or "no attestations"}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('attestations')
    parser.add_argument('--predicate-type', required=True)
    parser.add_argument('--digest', required=True)
    parser.add_argument('--expected-ref', required=True)
    parser.add_argument('--accepted-policy-versions', required=True,
                        help='comma-separated; from scripts/policy_info.py --field accepted_versions')
    parser.add_argument('--max-age-hours', type=int, default=168)
    parser.add_argument('--expected-policy-sha256')
    args = parser.parse_args()
    try:
        text = sys.stdin.read() if args.attestations == '-' else open(args.attestations).read()
        result = check(text, args.predicate_type, args.digest, args.expected_ref,
                       args.accepted_policy_versions, args.max_age_hours, args.expected_policy_sha256)
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        raise SystemExit(f'ERROR: {exc}')
    print(f'Verified policy approval: {args.expected_ref} decision={result["decision"]}')


if __name__ == '__main__':
    main()
