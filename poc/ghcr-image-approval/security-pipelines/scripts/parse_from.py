#!/usr/bin/env python3
"""Fail-closed parser for the one allowed upstream Dockerfile FROM reference."""
import argparse
import pathlib
import re

ALLOWED = re.compile(
    r"(?:docker\.io/library/)?eclipse-temurin:(?P<tag>[a-zA-Z0-9._-]+)@(?P<digest>sha256:[0-9a-f]{64})")
FROM_LINE = re.compile(r"^\s*FROM(?:\s+(?P<arg>.*))?$", flags=re.IGNORECASE)
REPOSITORY = 'docker.io/library/eclipse-temurin'


def parse(path):
    text = pathlib.Path(path).read_text()
    from_args = []
    for line in text.splitlines():
        m = FROM_LINE.match(line)
        if m:
            arg = (m.group('arg') or '').strip()
            if not arg:
                raise ValueError("FROM line without an image reference")
            from_args.append(arg)
    if len(from_args) != 1:
        raise ValueError("Expected exactly one FROM line")
    match = ALLOWED.fullmatch(from_args[0])
    if not match:
        raise ValueError("FROM must pin an approved eclipse-temurin tag with an actual sha256 digest; "
                         "run Renovate's pin-digest PR first")
    return {
        # Human-readable (tag kept for context). go-containerregistry tools accept this form.
        "upstream_ref": f"{REPOSITORY}:{match['tag']}@{match['digest']}",
        # Digest-only form. containers/image (skopeo) rejects references with both tag and digest.
        "upstream_digest_ref": f"{REPOSITORY}@{match['digest']}",
        "tag": match['tag'],
        "digest": match['digest'],
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument('dockerfile')
    p.add_argument('--field', required=True, choices=['upstream_ref', 'upstream_digest_ref', 'tag', 'digest'])
    args = p.parse_args()
    print(parse(args.dockerfile)[args.field])


if __name__ == '__main__':
    main()
