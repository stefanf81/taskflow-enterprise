#!/usr/bin/env python3
"""Bind a GHCR candidate to the image CONFIG digest that both builders attested.

Each builder computes the config digest from its own `docker save` archive
(ci/image_tar_identity.py) and GitHub-attests that file. The registry manifest's
config.digest must equal it. The config commits to every uncompressed layer through
rootfs.diff_ids, so equal config digests mean identical image content, whatever media
types or layer compression the registry manifest uses.

Do NOT pass `docker image inspect .Id` here: with the containerd image store that is the
OCI MANIFEST digest, which never equals a config digest (v2 compared those two values,
so every release failed at promote).

This is stronger than trusting an unsigned scanner 'PASS' report. It does not prove the
application code is benign or that either builder was uncompromised.
"""
import argparse
import json
import pathlib
import re

SHA = re.compile(r'sha256:[0-9a-f]{64}')


def verify(manifest_json, id_a, id_b):
    manifest = json.loads(pathlib.Path(manifest_json).read_text())
    a = pathlib.Path(id_a).read_text().strip()
    b = pathlib.Path(id_b).read_text().strip()
    if not SHA.fullmatch(a) or not SHA.fullmatch(b) or a != b:
        raise ValueError('two attested builder config digests must be equal SHA-256 digests')
    if not isinstance(manifest, dict) or 'manifests' in manifest:
        raise ValueError('expected single-platform OCI image manifest, not an image index')
    config = manifest.get('config')
    if not isinstance(config, dict) or config.get('digest') != a:
        raise ValueError('registry config digest differs from the attested builder config digest')
    layers = manifest.get('layers')
    if not isinstance(layers, list) or not layers or not all(isinstance(x,dict) and SHA.fullmatch(str(x.get('digest',''))) for x in layers):
        raise ValueError('invalid registry image layers')
    return a


def main():
    p=argparse.ArgumentParser()
    p.add_argument('manifest'); p.add_argument('config_digest_a'); p.add_argument('config_digest_b')
    a=p.parse_args()
    try: print(verify(a.manifest,a.config_digest_a,a.config_digest_b))
    except (ValueError, OSError, json.JSONDecodeError) as e: raise SystemExit(f'BUILD ORIGIN REJECTED: {e}')


if __name__=='__main__': main()
