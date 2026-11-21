#!/usr/bin/env python3
"""Verify independent release authorization from a protected CI gate.

This is NOT the app pipeline signing its own test result. A separately secured
release service must verify the exact commit's required checks and sign these
bytes with a private key unavailable to build/publish jobs. The release service
is an integration requirement; this repository does not implement that service.
Signature: OpenSSL RSA/ECDSA `openssl dgst -sha256 -sign key` output over the exact record
bytes. The pipeline fetches ONE document (--envelope) holding the base64 record and its
base64 signature; --record/--signature (two files) remain for local testing.
"""
import argparse
import base64
import binascii
import datetime as dt
import json
import pathlib
import re
import subprocess
import tempfile

SHA = re.compile(r'^[0-9a-f]{40}$')


def _utc(value):
    if not isinstance(value, str):
        raise ValueError('timestamp must be a string')
    date = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        raise ValueError('timestamp requires a timezone')
    return date.astimezone(dt.timezone.utc)


def _pairs_no_duplicates(pairs):
    out = {}
    for name, value in pairs:
        if name in out:
            raise ValueError(f'duplicate release authorization field: {name}')
        out[name] = value
    return out


def validate(data, commit, repository, schema, issuer, required_checks, now=None, max_issued_age_minutes=0):
    if not SHA.fullmatch(commit):
        raise ValueError('expected commit must be a full lowercase Git SHA1')
    if not isinstance(data, dict):
        raise ValueError('authorization must be a JSON object')
    for name, expected in [('schema', schema), ('repository', repository),
                           ('commit', commit), ('issuer', issuer), ('decision', 'APPROVED')]:
        if data.get(name) != expected:
            raise ValueError(f'wrong release authorization field {name}: {data.get(name)!r}')
    checks = data.get('checks')
    if not isinstance(checks, dict):
        raise ValueError('missing checks object')
    for check in required_checks:
        if checks.get(check) != 'PASS':
            raise ValueError(f'required independent release check {check!r} is not PASS')
    issued = _utc(data.get('issuedAt'))
    expires = _utc(data.get('expiresAt'))
    now = now or dt.datetime.now(dt.timezone.utc)
    if issued > now + dt.timedelta(minutes=5) or expires <= now:
        raise ValueError('authorization is expired or issued in the future')
    if expires <= issued or expires - issued > dt.timedelta(hours=24):
        raise ValueError('release authorization validity exceeds 24 hours')
    if max_issued_age_minutes and now - issued > dt.timedelta(minutes=max_issued_age_minutes):
        raise ValueError('release authorization is not freshly issued')
    return data


def verify(record, signature, public_key):
    # openssl dgst verifies a detached signature over exactly the bytes received.
    result = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(public_key),
                             '-signature', str(signature), str(record)],
                            capture_output=True, text=True)
    if result.returncode != 0 or 'Verified OK' not in result.stdout:
        raise ValueError('release authorization signature could not be verified')


def open_envelope(text):
    """Return (record_bytes, signature_bytes) from the single-document form.

    The gate returns ONE JSON document, so the record and its signature always belong
    together even when the gate issues a new record for every request:
        {"payload": "<base64 of the exact record JSON bytes>",
         "signature": "<base64 of `openssl dgst -sha256 -sign` over those bytes>"}
    """
    envelope = json.loads(text, object_pairs_hook=_pairs_no_duplicates)
    if not isinstance(envelope, dict) or set(envelope) - {'payload', 'signature', 'payloadType'}:
        raise ValueError('unexpected release authorization envelope fields')
    parts = []
    for name in ('payload', 'signature'):
        value = envelope.get(name)
        if not isinstance(value, str) or not value:
            raise ValueError(f'release authorization envelope lacks {name}')
        try:
            parts.append(base64.b64decode(value, validate=True))
        except (binascii.Error, ValueError):
            raise ValueError(f'release authorization envelope {name} is not valid base64') from None
    return parts[0], parts[1]


def main():
    p = argparse.ArgumentParser()
    for name in ('public-key', 'expected-commit', 'expected-repository',
                 'expected-schema', 'expected-issuer', 'required-checks'):
        p.add_argument('--' + name, required=True)
    p.add_argument('--envelope', help='single JSON document with base64 payload and signature (pipeline form)')
    p.add_argument('--record', help='record JSON file (with --signature; for local testing)')
    p.add_argument('--signature', help='detached binary signature file (with --record)')
    p.add_argument('--write-record', help='with --envelope: write the VERIFIED record bytes to this file')
    p.add_argument('--max-issued-age-minutes', type=int, default=0, help='require freshly issued grant')
    a = p.parse_args()
    if bool(a.envelope) == bool(a.record or a.signature) or bool(a.record) != bool(a.signature):
        p.error('use either --envelope, or --record together with --signature')
    try:
        if a.envelope:
            payload, signature = open_envelope(pathlib.Path(a.envelope).read_text(encoding='utf-8'))
            with tempfile.TemporaryDirectory() as tmp:
                record = pathlib.Path(tmp) / 'record.json'
                detached = pathlib.Path(tmp) / 'record.sig'
                record.write_bytes(payload)
                detached.write_bytes(signature)
                verify(record, detached, pathlib.Path(a.public_key))
            text = payload.decode('utf-8')
        else:
            record = pathlib.Path(a.record)
            verify(record, pathlib.Path(a.signature), pathlib.Path(a.public_key))
            payload = record.read_bytes()
            text = payload.decode('utf-8')
        data = json.loads(text, object_pairs_hook=_pairs_no_duplicates)
        validate(data, a.expected_commit, a.expected_repository, a.expected_schema,
                 a.expected_issuer, [c.strip() for c in a.required_checks.split(',') if c.strip()],
                 max_issued_age_minutes=a.max_issued_age_minutes)
        if a.write_record:
            pathlib.Path(a.write_record).write_bytes(payload)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f'RELEASE DENIED: {exc}')
    print('Verified independent release authorization for ' + a.expected_commit)


if __name__ == '__main__':
    main()
