#!/usr/bin/env python3
"""Read the identity of ONE image from a `docker save` / `crane pull` archive without extracting it.

Prints the image CONFIG digest (sha256 of the config JSON bytes). That digest is what the
builders attest and what promote compares with the registry manifest's `config.digest`:

  * `docker image inspect .Id` is NOT usable for that comparison. With the containerd image
    store (required for reproducible builds) `.Id` is the digest of the OCI manifest, and
    a registry push may rewrite the manifest (crane writes Docker media types), while the
    config bytes - which commit to every uncompressed layer through rootfs.diff_ids - stay
    the same.

Checks, all fail closed:
  * the archive holds exactly one image whose RepoTags are exactly [--expected-repotag]
    (so `docker load` cannot also retag some other image on the runner);
  * the Config member is blobs/sha256/<hex> and its bytes hash to <hex>;
  * every layer is streamed, decompressed (gzip if needed), and SHA-256 checked against
    its corresponding, ordered rootfs.diff_id; archive budgets are enforced;
  * the number of Layers equals the number of rootfs.diff_ids in the config;
  * when the archive also carries an OCI index.json (containerd image store), it names a
    single manifest whose config descriptor is that same digest.

Usage: image_tar_identity.py ARCHIVE [--expected-repotag NAME:TAG] [--output FILE]
                             [--field config_digest|platform|diff_ids]
"""
import argparse
import gzip
import hashlib
import json
import pathlib
import re
import sys
import tarfile

SHA = re.compile(r'sha256:[a-f0-9]{64}')
BLOB = re.compile(r'blobs/sha256/([a-f0-9]{64})')
MAX_JSON = 4 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 1024
MAX_LAYERS = 256
# All verification streams data; it never extracts an untrusted image into the filesystem.
# Both archive members and uncompressed streams are bounded to reduce decompression-bomb risk.
MAX_LAYER_UNCOMPRESSED = 8 * 1024 ** 3
MAX_TOTAL_UNCOMPRESSED = 32 * 1024 ** 3
CHUNK = 1 << 20


def _member_bytes(tar, name):
    try:
        member = tar.getmember(name)
    except KeyError:
        raise ValueError(f'archive has no {name}')
    if not member.isfile() or member.size > MAX_JSON:
        raise ValueError(f'{name} is not a small regular file')
    return tar.extractfile(member).read()


def _json(tar, name):
    try:
        return json.loads(_member_bytes(tar, name))
    except json.JSONDecodeError as e:
        raise ValueError(f'{name} is not valid JSON: {e}')


def _verified_layer_diff_id(tar, name, expected, total_so_far):
    """Hash actual (decompressed) layer bytes, not untrusted rootfs.diff_ids claims.

    A Docker-save layer is usually an uncompressed TAR; some archive builders supply
    gzip-compressed TAR blobs. zstd is deliberately unsupported/fails closed. A layer
    must be a unique regular archive member and must match its declared diff_id.
    """
    if not isinstance(name, str) or not name or name.startswith('/') or '\\' in name or '..' in name.split('/'):
        raise ValueError(f'unsafe layer archive member {name!r}')
    try:
        member = tar.getmember(name)
    except KeyError:
        raise ValueError(f'archive has no layer member {name!r}')
    if not member.isfile():
        raise ValueError(f'layer {name!r} is not a regular file')
    if member.size > MAX_TOTAL_UNCOMPRESSED:
        raise ValueError(f'layer {name!r} exceeds compressed member byte budget')
    # When the archive uses OCI content-addressed blob names, validate the actual
    # archived (possibly compressed) bytes against that name too. A matching uncompressed
    # diff_id alone is not sufficient to authenticate an OCI descriptor/blob digest.
    blob_name = BLOB.fullmatch(name)
    if blob_name:
        raw_hash = hashlib.sha256()
        with tar.extractfile(member) as stored:
            while True:
                data = stored.read(CHUNK)
                if not data:
                    break
                raw_hash.update(data)
        if raw_hash.hexdigest() != blob_name.group(1):
            raise ValueError(f'content-addressed blob {name!r} has wrong stored-byte digest')
    with tar.extractfile(member) as raw:
        prefix = raw.read(4)
        raw.seek(0)
        if prefix == b'\x28\xb5\x2f\xfd':
            raise ValueError('zstd layer compression is unsupported (fail closed)')
        reader = gzip.GzipFile(fileobj=raw, mode='rb') if prefix[:2] == b'\x1f\x8b' else raw
        hasher = hashlib.sha256()
        count = 0
        try:
            while True:
                chunk = reader.read(CHUNK)
                if not chunk:
                    break
                count += len(chunk)
                if count > MAX_LAYER_UNCOMPRESSED or total_so_far + count > MAX_TOTAL_UNCOMPRESSED:
                    raise ValueError('image layer content exceeds decompression byte budget')
                hasher.update(chunk)
        except (OSError, EOFError) as exc:
            raise ValueError(f'cannot fully decode layer {name!r}: {exc}') from exc
        finally:
            if reader is not raw:
                reader.close()
    actual = 'sha256:' + hasher.hexdigest()
    if actual != expected:
        raise ValueError(f'layer {name!r} bytes does not match diff_id {expected}')
    return count



def identity(archive, expected_repotag=None):
    """Return {'config_digest', 'diff_ids', 'layers', 'manifest_digest'} for the single image."""
    with tarfile.open(archive, 'r:') as tar:
        names = []
        for member in tar:
            names.append(member.name)
            if len(names) > MAX_ARCHIVE_MEMBERS or len(member.name) > 4096:
                raise ValueError('image archive exceeds member-count or path-length limit')
        if len(names) != len(set(names)):
            raise ValueError('archive contains duplicate member names')
        manifest = _json(tar, 'manifest.json')
        if not isinstance(manifest, list) or len(manifest) != 1 or not isinstance(manifest[0], dict):
            raise ValueError('archive must contain exactly one image')
        entry = manifest[0]
        tags = entry.get('RepoTags')
        if expected_repotag is not None and tags != [expected_repotag]:
            raise ValueError(f'archive RepoTags {tags!r} are not exactly [{expected_repotag!r}]')
        config_name = entry.get('Config')
        # docker save (containerd store): blobs/sha256/<hex>; crane pull: sha256:<hex>;
        # docker save (classic store): <hex>.json
        match = (BLOB.fullmatch(config_name or '') or re.fullmatch(r'sha256:([a-f0-9]{64})', config_name or '')
                 or re.fullmatch(r'([a-f0-9]{64})\.json', config_name or ''))
        if not match:
            raise ValueError('Config must be a content-addressed name (blobs/sha256/<hex>, sha256:<hex>, <hex>.json)')
        config_bytes = _member_bytes(tar, config_name)
        config_hex = hashlib.sha256(config_bytes).hexdigest()
        if config_hex != match.group(1):
            raise ValueError('config bytes do not hash to their content-addressed name')
        config = json.loads(config_bytes)
        diff_ids = ((config.get('rootfs') or {}).get('diff_ids'))
        if not isinstance(diff_ids, list) or not diff_ids or not all(isinstance(d, str) and SHA.fullmatch(d) for d in diff_ids):
            raise ValueError('config has no valid rootfs.diff_ids')
        layers = entry.get('Layers')
        if len(diff_ids) > MAX_LAYERS:
            raise ValueError('image has too many layers')
        if not isinstance(layers, list) or len(layers) != len(diff_ids) or not all(isinstance(x, str) for x in layers):
            raise ValueError('Layers do not match rootfs.diff_ids')
        # OCI manifests may reference the same content-addressed blob more than once;
        # compare each occurrence against its ordered diff_id independently.
        verified_total = 0
        for layer_name, declared_diff_id in zip(layers, diff_ids):
            verified_total += _verified_layer_diff_id(tar, layer_name, declared_diff_id, verified_total)
        manifest_digest = None
        if 'index.json' in names:
            index = _json(tar, 'index.json')
            manifests = index.get('manifests') if isinstance(index, dict) else None
            if not isinstance(manifests, list) or len(manifests) != 1:
                raise ValueError('OCI index.json must name exactly one manifest')
            manifest_digest = manifests[0].get('digest')
            hex_ = SHA.fullmatch(manifest_digest or '') and manifest_digest.split(':', 1)[1]
            if not hex_:
                raise ValueError('invalid OCI manifest digest')
            oci_bytes = _member_bytes(tar, f'blobs/sha256/{hex_}')
            if hashlib.sha256(oci_bytes).hexdigest() != hex_:
                raise ValueError('OCI manifest bytes do not hash to their digest')
            oci = json.loads(oci_bytes)
            if (oci.get('config') or {}).get('digest') != 'sha256:' + config_hex:
                raise ValueError('OCI manifest and Docker manifest.json name different configs')
            oci_layers = oci.get('layers')
            if not isinstance(oci_layers, list) or len(oci_layers) != len(layers):
                raise ValueError('OCI manifest layers do not match docker manifest layer count')
            for descriptor, member_name in zip(oci_layers, layers):
                if not isinstance(descriptor, dict) or not SHA.fullmatch(str(descriptor.get('digest', ''))):
                    raise ValueError('OCI manifest contains invalid layer descriptor')
                # OCI docker-save archive layers may carry their content-addressed blob
                # names directly. Those MUST match the OCI descriptor, including order.
                match = BLOB.fullmatch(member_name)
                if match and descriptor['digest'] != 'sha256:' + match.group(1):
                    raise ValueError('OCI manifest descriptor disagrees with layer blob name/order')
    os_, arch, variant = config.get('os'), config.get('architecture'), config.get('variant')
    platform = '/'.join(x for x in (os_, arch, variant) if x)
    if not re.fullmatch(r'linux/[a-z0-9_]+(?:/[a-z0-9_]+)?', platform):
        raise ValueError(f'unsupported image platform {platform!r}')
    return {'config_digest': 'sha256:' + config_hex, 'diff_ids': diff_ids, 'layers': layers,
            'manifest_digest': manifest_digest, 'platform': platform}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('archive')
    p.add_argument('--expected-repotag')
    p.add_argument('--output', help='also write the config digest to this file')
    p.add_argument('--field', choices=['config_digest', 'platform', 'diff_ids'], default='config_digest',
                   help='what to print (diff_ids as a JSON list)')
    a = p.parse_args()
    try:
        result = identity(a.archive, a.expected_repotag)
    except (ValueError, OSError, tarfile.TarError, json.JSONDecodeError) as e:
        raise SystemExit(f'IMAGE ARCHIVE REJECTED: {e}')
    if a.output:
        pathlib.Path(a.output).write_text(result['config_digest'] + '\n')
    value = result[a.field]
    print(json.dumps(value) if a.field == 'diff_ids' else value)


if __name__ == '__main__':
    sys.exit(main())
