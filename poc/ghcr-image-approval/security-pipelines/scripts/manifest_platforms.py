#!/usr/bin/env python3
"""Discover all runnable OS/CPU platforms and fail closed on platform drift.

Attestation manifests (BuildKit `vnd.docker.reference.type: attestation-manifest`, usually
with platform unknown/unknown) are metadata, not runnable images, and are skipped.
"""
import argparse
import json
import pathlib

ATTESTATION_ANNOTATION = 'vnd.docker.reference.type'


def platforms(path):
    obj = json.loads(pathlib.Path(path).read_text())
    if 'manifests' not in obj:
        raise ValueError(f'{path}: expected an OCI/Docker image index (single arch not supported by this example)')
    result = set()
    for descriptor in obj['manifests']:
        annotations = descriptor.get('annotations') or {}
        p = descriptor.get('platform') or {}
        os_name, arch, variant = p.get('os', ''), p.get('architecture', ''), p.get('variant', '')
        if annotations.get(ATTESTATION_ANNOTATION) == 'attestation-manifest' or (os_name, arch) == ('unknown', 'unknown'):
            continue  # Metadata artifact, not an executable container image.
        if not os_name or not arch:
            raise ValueError(f'{path}: missing descriptor platform metadata')
        if os_name != 'linux':
            raise ValueError(f'{path}: unsupported non-Linux platform {os_name}/{arch}')
        value = '/'.join(s for s in (os_name, arch, variant) if s)
        if value in result:
            raise ValueError(f'{path}: duplicate platform {value}')
        result.add(value)
    if not result:
        raise ValueError(f'{path}: empty executable platform set')
    return result


def compare(baseline_index, candidate_index):
    old = platforms(baseline_index)
    new = platforms(candidate_index)
    if old != new:
        raise ValueError(f'Platform drift requires dedicated review/handling: '
                         f'removed={sorted(old - new)}, added={sorted(new - old)}')
    return sorted(new)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('baseline_index')
    p.add_argument('candidate_index')
    args = p.parse_args()
    print(','.join(compare(args.baseline_index, args.candidate_index)))


if __name__ == '__main__':
    main()
