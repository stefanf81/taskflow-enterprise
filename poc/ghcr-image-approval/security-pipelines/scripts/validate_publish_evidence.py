#!/usr/bin/env python3
"""Check the scanner stage's evidence before the isolated signer sees a digest.

This is NOT cryptographic attestation of a builder. It only validates the evidence
handed off by the protected GitHub Actions workflow's independently isolated scanner.
"""
import argparse
import hashlib
import json
import pathlib
import re


def verify(directory, repository, tag, artifact_manifest, release_repository=None):
    directory = pathlib.Path(directory)
    ref = (directory / 'pushed-ref.txt').read_text().strip()
    if not re.fullmatch(re.escape(repository) + r'@sha256:[a-f0-9]{64}', ref):
        raise ValueError('invalid or unexpected immutable application image reference')
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+', tag):
        raise ValueError('invalid image tag')
    report = json.loads((directory / 'vulnerability-decision.json').read_text())
    # REVIEW = High findings awaiting a named human approval; the independent verification
    # (signed) must later show them approved. BLOCK never gets here.
    if report.get('decision') not in ('PASS', 'REVIEW') or report.get('image_ref') != ref:
        raise ValueError('scanner has not accepted this exact pushed digest')
    if release_repository is not None and report.get('release_ref') != release_repository + '@' + ref.split('@')[1]:
        raise ValueError('exceptions were not matched against the release reference of this digest')
    config_digest = (directory / 'config-digest.txt').read_text().strip()
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', config_digest):
        raise ValueError('missing builder-attested image config digest')
    platform = (directory / 'platform.txt').read_text().strip()
    if not re.fullmatch(r'linux/[a-z0-9_]+(?:/[a-z0-9_]+)?', platform) or report.get('platform') != platform:
        raise ValueError('scanner platform mismatch')
    sbom = json.loads((directory / 'app-sbom.json').read_text())
    if not isinstance(sbom, dict) or sbom.get('bomFormat') != 'CycloneDX':
        raise ValueError('expected CycloneDX application SBOM')
    bases = [line.strip() for line in (directory / 'base-images.txt').read_text().splitlines() if line.strip()]
    final_base = (directory / 'final-base.txt').read_text().strip()
    if not bases or final_base not in bases:
        raise ValueError('missing verified base references')
    if report.get('base_image_ref') not in (None, final_base):
        raise ValueError('vulnerability exceptions were evaluated against a different base image')
    manifest = pathlib.Path(artifact_manifest).read_bytes()
    if hashlib.sha256(manifest).hexdigest() != (directory / 'artifact-manifest-sha256.txt').read_text().strip():
        raise ValueError('application artifact manifest mismatch')
    artifacts = json.loads(manifest)
    if not artifacts.get('files') or artifacts.get('schema') != 'https://example.org/verified-build-artifacts/v1':
        raise ValueError('invalid application artifact manifest')
    return ref


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--directory', required=True)
    p.add_argument('--expected-repository', required=True)
    p.add_argument('--expected-tag', required=True)
    p.add_argument('--artifact-manifest', required=True)
    p.add_argument('--release-repository', required=True, help='applications/<app> repository')
    args = p.parse_args()
    try:
        print(verify(args.directory, args.expected_repository, args.expected_tag, args.artifact_manifest,
                     args.release_repository))
    except (ValueError, OSError, json.JSONDecodeError) as e:
        raise SystemExit(f'INVALID PUBLISH EVIDENCE: {e}')


if __name__ == '__main__':
    main()
