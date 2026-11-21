#!/usr/bin/env python3
"""Bind an independently computed Grype decision to an exact registry digest.

Flow (.github/workflows/application-release.yml):
  1. A keyless rescan worker pulls the promoted digest, refreshes the Grype database, scans,
     fetches the approved base image's config itself and re-runs ci/check_additive_layers.py
     on the pulled image (both are needed for origin-proven base exceptions).
  2. A separate verifier worker, which holds the verification key but never pulls or parses
     the image, evaluates the policy on that report (--issue) and signs a canonical record.
  3. The application-signing worker verifies the signature and every claim (--verify) and
     re-evaluates the policy at signing time.

The record binds: image digest, platform, commit, policy file, Grype report, base config, the
human approval of High findings (approver + exact finding list) and applied exceptions.
This is a protected-verifier assertion, NOT SLSA provenance or proof of benign code. A
compromised rescan worker can still hide findings for the image it scans; it cannot steal
the verification key.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from check_application_vulnerabilities import (base_layers_from_config, decision,  # noqa: E402
                                               findings_sha256, load_approved_high,
                                               load_layer_overlay)
from evaluate import critical_exceptions  # noqa: E402

SCHEMA = 'https://example.org/independent-image-verification/v1'
REF = re.compile(r'^[a-z0-9.-]+(?::[0-9]+)?/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$')


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def canonical(obj):
    return (json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def scan_targets_digest(scan, image):
    """Fail closed: scanner target must match the exact repository and digest.

    A bare manifestDigest is supplementary evidence only; it cannot establish
    which repository was scanned. Avoid substring checks (old v10 weakness).
    """
    target = ((scan.get('source') or {}).get('target')) or {}
    if not isinstance(target, dict):
        raise ValueError('Grype report has no source target')
    digest = image.split('@', 1)[1]
    references = [target.get('userInput'), *(target.get('repoDigests') or [])]
    if not any(isinstance(x, str) and x in (image, 'registry:' + image) for x in references):
        raise ValueError('Grype target does not equal the expected immutable repository@digest')
    manifest_digest = target.get('manifestDigest')
    if manifest_digest is not None and manifest_digest != digest:
        raise ValueError('Grype manifest digest contradicts exact target')


def _high_approval(approved_high):
    if not approved_high:
        return None, None
    approver, findings = load_approved_high(approved_high)
    findings = sorted(findings)
    return approver, findings


def _unmodified(layer_overlay, base_layers):
    if not layer_overlay:
        return False
    if not base_layers:
        raise ValueError('a layer overlay report needs the base image config')
    return load_layer_overlay(layer_overlay, base_layers)


def create(image, platform, grype, policy, base, commit, now=None, base_config=None, approved_high=None,
           layer_overlay=None):
    if not REF.fullmatch(image) or not re.fullmatch(r'linux/[a-z0-9_]+(?:/[a-z0-9_]+)?', platform):
        raise ValueError('invalid immutable image or platform')
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('invalid commit')
    now = now or dt.datetime.now(dt.timezone.utc)
    policy_data = json.loads(pathlib.Path(policy).read_text())
    scan_data = json.loads(pathlib.Path(grype).read_text())
    scan_targets_digest(scan_data, image)
    base_layers = base_layers_from_config(json.loads(pathlib.Path(base_config).read_text())) if base_config else None
    approver, findings = _high_approval(approved_high)
    unmodified = _unmodified(layer_overlay, base_layers)
    exceptions = critical_exceptions(policy_data, now.date())
    result = decision(scan_data, exceptions, image, platform, base or None, base_layers, image, findings,
                      unmodified)
    if result['decision'] != 'PASS':
        extra = ''
        if result['high']:
            extra = (' (High findings not covered by the human approval: '
                     f"{[f'{e[0]} {e[1]} {e[2]}' for e in ([x['id'], x['package'], x['package_version']] for x in result['high'])]})")
        raise ValueError('independent verifier refuses image: ' + result['decision'] + extra)
    return dict(schema=SCHEMA, image=image, platform=platform, sourceCommit=commit, baseImage=base,
                verifiedAt=now.isoformat().replace('+00:00', 'Z'),
                decision=result['decision'], policyVersion=policy_data['version'],
                policySha256=digest(policy), scanSha256=digest(grype),
                baseConfigSha256=digest(base_config) if base_config else None,
                layerOverlaySha256=digest(layer_overlay) if layer_overlay else None,
                baseFilesUnmodified=unmodified,
                highApproval=({'approver': approver, 'findings': findings,
                               'findingsSha256': findings_sha256(result['high_approved'])}
                              if approver else None),
                highApproved=result['high_approved'],
                criticalExceptions=result['critical_excepted'],
                unknownExceptions=result['unknown_excepted'])


def validate(record, image, platform, commit, policy, scan, now=None, max_age_minutes=10, base_config=None,
             expected_high_approver=None, layer_overlay=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if record.get('schema') != SCHEMA:
        raise ValueError('invalid verifier schema')
    for key, value in [('image', image), ('platform', platform), ('sourceCommit', commit),
                       ('policySha256', digest(policy)), ('scanSha256', digest(scan)), ('decision', 'PASS')]:
        if record.get(key) != value:
            raise ValueError(f'verifier claim mismatch: {key}')
    issued = dt.datetime.fromisoformat(record['verifiedAt'].replace('Z', '+00:00'))
    if issued.tzinfo is None or issued > now + dt.timedelta(seconds=30) or now - issued > dt.timedelta(minutes=max_age_minutes):
        raise ValueError('independent scan attestation expired or future-dated')
    policy_data = json.loads(pathlib.Path(policy).read_text())
    if record.get('policyVersion') != policy_data.get('version'):
        raise ValueError('policy version mismatch')
    base_layers = None
    if record.get('baseConfigSha256') is not None:
        if not base_config or digest(base_config) != record['baseConfigSha256']:
            raise ValueError('base image config differs from the one the verifier used')
        base_layers = base_layers_from_config(json.loads(pathlib.Path(base_config).read_text()))
    if record.get('layerOverlaySha256') is not None:
        if not layer_overlay or digest(layer_overlay) != record['layerOverlaySha256']:
            raise ValueError('layer overlay report differs from the one the verifier used')
    elif layer_overlay:
        raise ValueError('verifier did not use a layer overlay report')
    unmodified = _unmodified(layer_overlay, base_layers)
    if record.get('baseFilesUnmodified') is not unmodified:
        raise ValueError('verifier claim mismatch: baseFilesUnmodified')
    approval = record.get('highApproval')
    findings = approval['findings'] if approval else None
    approver = approval['approver'] if approval else ''
    if expected_high_approver is not None and approver != expected_high_approver:
        raise ValueError('High-finding approver differs from the pipeline\'s recorded approver')
    scan_data = json.loads(pathlib.Path(scan).read_text())
    scan_targets_digest(scan_data, image)
    updated = decision(scan_data, critical_exceptions(policy_data, now.date()), image, platform,
                       record.get('baseImage') or None, base_layers, image, findings, unmodified)
    if updated['decision'] != 'PASS':
        raise ValueError('re-evaluation of signed scan no longer passes')
    if (updated['critical_excepted'] != record.get('criticalExceptions') or
            updated['unknown_excepted'] != record.get('unknownExceptions') or
            updated['high_approved'] != record.get('highApproved')):
        raise ValueError('exception grants or High approvals differ from the signed verification')
    return True


def main():
    p = argparse.ArgumentParser()
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--issue', action='store_true')
    mode.add_argument('--verify', action='store_true')
    for name in ('image', 'platform', 'commit', 'policy', 'scan', 'record'):
        p.add_argument('--' + name, required=True)
    p.add_argument('--base', default='')
    p.add_argument('--base-config', help='crane config JSON of --base, fetched by the rescan worker')
    p.add_argument('--layer-overlay', help='ci/check_additive_layers.py report of the pulled image')
    p.add_argument('--approved-high', help='JSON {"approver", "findings"} from the human review (issue only)')
    p.add_argument('--expected-high-approver', help="verify: approver recorded by the pipeline ('' if none)")
    p.add_argument('--signature', required=True)
    p.add_argument('--private-key')
    p.add_argument('--public-key')
    p.add_argument('--max-age-minutes', type=int, default=10)
    a = p.parse_args()
    try:
        if a.issue:
            if not a.private_key or a.public_key:
                raise ValueError('issuer needs private key only')
            record = create(a.image, a.platform, a.scan, a.policy, a.base, a.commit,
                            base_config=a.base_config, approved_high=a.approved_high,
                            layer_overlay=a.layer_overlay)
            pathlib.Path(a.record).write_bytes(canonical(record))
            cmd = ['openssl', 'dgst', '-sha256', '-sign', a.private_key, '-out', a.signature, a.record]
        else:
            if not a.public_key or a.private_key:
                raise ValueError('verifier needs public key only')
            cmd = ['openssl', 'dgst', '-sha256', '-verify', a.public_key, '-signature', a.signature, a.record]
        completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if completed.returncode:
            raise ValueError('cryptographic signature operation failed: ' + completed.stderr.strip())
        if a.verify:
            record = json.loads(pathlib.Path(a.record).read_text())
            validate(record, a.image, a.platform, a.commit, a.policy, a.scan,
                     max_age_minutes=a.max_age_minutes, base_config=a.base_config,
                     expected_high_approver=a.expected_high_approver, layer_overlay=a.layer_overlay)
        print('independent scanner attestation ' + ('issued' if a.issue else 'verified'))
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as e:
        raise SystemExit('INDEPENDENT VERIFICATION FAILED: ' + str(e))


if __name__ == '__main__':
    main()
