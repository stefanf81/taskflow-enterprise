#!/usr/bin/env python3
"""Validate Cosign-verified in-toto build record against a locally constructed record.

Input MUST be the output of `cosign verify-attestation --key EXPECTED_PUBKEY`,
not arbitrary JSON fetched from GHCR or another untrusted source.
"""
import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from check_approval_attestation import statements, predicate_of


def check(attestations, record, predicate_type):
    expected = json.loads(pathlib.Path(record).read_text())
    expected_ref = expected['image']
    repository, digest = expected_ref.rsplit('@', 1)
    if not digest.startswith('sha256:') or len(digest) != 71:
        raise ValueError('invalid expected image digest')
    for item in statements(pathlib.Path(attestations).read_text()):
        if item.get('predicateType') != predicate_type:
            continue
        if not any(s.get('name') == repository and
                   (s.get('digest') or {}).get('sha256') == digest[7:]
                   for s in item.get('subject', [])):
            continue
        if predicate_of(item) == expected:
            return True
    raise ValueError('no verified statement matches the intended image, predicate and evidence')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--attestations', required=True)
    p.add_argument('--record', required=True)
    p.add_argument('--predicate-type', required=True)
    a = p.parse_args()
    try:
        check(a.attestations, a.record, a.predicate_type)
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise SystemExit(f'INVALID VERIFIED BUILD RECORD: {exc}')
    print('Verified application build record agrees with requested digest and evidence')


if __name__ == '__main__':
    main()
