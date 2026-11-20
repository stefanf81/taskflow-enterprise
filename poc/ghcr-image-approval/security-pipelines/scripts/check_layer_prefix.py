#!/usr/bin/env python3
"""Check that a built image really sits on top of the approved base image.

Compares uncompressed layer digests (diff_ids): the built image's layer list must START with
the approved base's layer list for the same platform. This is checked on the trusted publisher
and does not rely on anything the build agent reported about which base it used.

  docker image inspect --format '{{json .RootFS.Layers}}' IMAGE > image-layers.json
  crane config --platform OS/ARCH[/VARIANT] APPROVED_BASE@sha256:... > base-config.json
  check_layer_prefix.py --image-layers image-layers.json --base-config base-config.json
"""
import argparse
import json
import re

DIFF_ID = re.compile(r'^sha256:[0-9a-f]{64}$')


def check(image_layers, base_config):
    base = ((base_config or {}).get('rootfs') or {}).get('diff_ids')
    if not isinstance(base, list) or not base:
        raise ValueError('approved base config has no rootfs.diff_ids')
    if not isinstance(image_layers, list) or not image_layers:
        raise ValueError('built image has no layers')
    for layer in base + image_layers:
        if not isinstance(layer, str) or not DIFF_ID.match(layer):
            raise ValueError(f'invalid layer digest {layer!r}')
    if image_layers[:len(base)] != base:
        raise ValueError('built image layers do not start with the approved base image layers')
    return len(base), len(image_layers) - len(base)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--image-layers', required=True)
    p.add_argument('--base-config', required=True)
    args = p.parse_args()
    try:
        with open(args.image_layers, encoding='utf-8') as f:
            layers = json.load(f)
        with open(args.base_config, encoding='utf-8') as f:
            config = json.load(f)
        base_count, added = check(layers, config)
    except (OSError, ValueError) as e:
        raise SystemExit(f'ERROR: {e}')
    print(f'OK: image starts with all {base_count} approved base layers (+{added} application layers)')


if __name__ == '__main__':
    main()
