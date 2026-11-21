#!/usr/bin/env python3
"""Prove (or fail to prove) that an application's own layers never change a base-image file.

Base-image CVE exceptions (`base_image_ref` in policy/config.json) may only be inherited by
an application when the vulnerable package demonstrably still has the base image's bytes.
Grype's package locations say which layer a package database entry came from; they do not
say whether a later layer overwrote the package's files. This script closes that gap:

  ADDITIVE  every application layer only ADDS new paths (or re-declares existing base
            directories). No base file, symlink or special file is overwritten, no base path
            is deleted by a whiteout, no opaque whiteout hides a base directory, and nothing
            is written through a symlink.

Every layer is decompressed and its uncompressed SHA-256 is compared with the config's
rootfs.diff_ids, so the report is bound to the exact image config. The application layers
must follow the approved base's diff_ids as an exact prefix.

The result is a report, not a pass/fail gate: an image that is not additive is still
scanned and released normally - it only cannot inherit base-image exceptions.
Unsupported layer compression (e.g. zstd) also yields additive=false (fail closed), and so
does a layer that exceeds the analysis budgets below (entries, bytes, path length): a very
large image is released without inherited exceptions, it is not blocked. Only malformed
input (a layer whose bytes do not match its diff_id, an unsafe path, layers that do not
extend the base) makes the script fail.

Usage: check_additive_layers.py ARCHIVE --base-config BASE_CONFIG.json --output REPORT.json
"""
import argparse
import gzip
import hashlib
import json
import pathlib
import posixpath
import sys
import tarfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from image_tar_identity import SHA, identity  # noqa: E402

SCHEMA = 'https://example.org/additive-application-layers/v1'
MAX_VIOLATIONS = 50
# Resource ceilings for this analysis; exceeding one stops it and reports additive=false.
MAX_LAYER_COUNT = 256
MAX_LAYER_ENTRIES = 250_000
MAX_LAYER_UNCOMPRESSED = 4 * 1024 ** 3
MAX_TOTAL_ENTRIES = 1_000_000
MAX_PATH_LENGTH = 4096


class BudgetExceeded(ValueError):
    """The image is too large for this analysis (not malformed): report it as not additive."""


class _HashingReader:
    """File-like wrapper hashing every byte read (the uncompressed layer stream)."""

    def __init__(self, raw):
        self.raw, self.sha, self.count = raw, hashlib.sha256(), 0

    def read(self, size=-1):
        data = self.raw.read(size)
        self.count += len(data)
        if self.count > MAX_LAYER_UNCOMPRESSED:
            raise BudgetExceeded('layer decompression exceeds permitted byte budget')
        self.sha.update(data)
        return data

    def drain(self):
        while self.read(1 << 20):
            pass
        return 'sha256:' + self.sha.hexdigest()


def _open_layer(blob):
    head = blob.read(4)
    blob.seek(0)
    if head[:2] == b'\x1f\x8b':
        return gzip.GzipFile(fileobj=blob, mode='rb')
    if head == b'\x28\xb5\x2f\xfd':
        raise NotImplementedError('zstd-compressed layer')
    return blob


def _norm(name):
    name = name.lstrip('/')
    while name.startswith('./'):
        name = name[2:]
    name = name.rstrip('/')
    if not name or name == '.':
        return ''
    if len(name.encode('utf-8')) > MAX_PATH_LENGTH:
        raise BudgetExceeded('layer path exceeds permitted length')
    parts = name.split('/')
    if any(p in ('', '.', '..') for p in parts):
        raise ValueError(f'unsafe layer path {name!r}')
    return name


def _ancestors(path):
    parts = path.split('/')
    return ['/'.join(parts[:i]) for i in range(1, len(parts))]


def layer_entries(tar, member_name, expected_diff_id):
    """Yield (path, kind, metadata) for one layer and verify its uncompressed digest."""
    with tar.extractfile(member_name) as blob:
        reader = _HashingReader(_open_layer(blob))
        entries = []
        with tarfile.open(fileobj=reader, mode='r|') as layer:
            for m in layer:
                if len(entries) >= MAX_LAYER_ENTRIES:
                    raise BudgetExceeded('layer has excessive TAR member count')
                if m.size > MAX_LAYER_UNCOMPRESSED:
                    raise BudgetExceeded('layer member exceeds byte budget')
                path = _norm(m.name)
                if not path:
                    continue
                kind = 'dir' if m.isdir() else 'symlink' if m.issym() else 'hardlink' if m.islnk() else 'file'
                entries.append((path, kind, (m.mode, m.uid, m.gid, sorted(m.pax_headers.items()))))
        if reader.drain() != expected_diff_id:
            raise ValueError(f'layer {member_name} does not match diff_id {expected_diff_id}')
    return entries


def analyse(archive, base_config):
    base_diff_ids = ((base_config.get('rootfs') or {}).get('diff_ids'))
    if not isinstance(base_diff_ids, list) or not base_diff_ids or not all(isinstance(d, str) and SHA.fullmatch(d) for d in base_diff_ids):
        raise ValueError('base config has no valid rootfs.diff_ids')
    ident = identity(archive)
    diff_ids, layers = ident['diff_ids'], ident['layers']
    n = len(base_diff_ids)
    if len(diff_ids) > MAX_LAYER_COUNT:
        raise ValueError('image has excessive layer count')
    if diff_ids[:n] != base_diff_ids or len(diff_ids) <= n:
        raise ValueError('image layers do not extend the approved base layers exactly')
    report = {'schema': SCHEMA, 'config_digest': ident['config_digest'], 'base_diff_ids': base_diff_ids,
              'application_layer_count': len(diff_ids) - n, 'additive': False, 'violations': []}
    violations = report['violations']

    def violate(msg):
        if len(violations) < MAX_VIOLATIONS:
            violations.append(msg)

    base_kind = {}
    base_meta = {}
    total_entries = 0

    def entries_in_layer(tar, name, expected):
        nonlocal total_entries
        entries = layer_entries(tar, name, expected)
        total_entries += len(entries)
        if total_entries > MAX_TOTAL_ENTRIES:
            raise BudgetExceeded('image has excessive total TAR members')
        return entries

    def overlaps_base(path):
        # OCI whiteouts can delete a *directory* that never appeared as an explicit
        # TAR member: a file such as opt/java/lib.so implies ancestor opt/.
        return any(k == path or k.startswith(path + '/') for k in base_kind)

    try:
        with tarfile.open(archive, 'r:') as tar:
            for i in range(n):
                for path, kind, metadata in entries_in_layer(tar, layers[i], diff_ids[i]):
                    name = posixpath.basename(path)
                    parent = posixpath.dirname(path)
                    if name == '.wh..wh..opq':
                        for p in [p for p in base_kind if p.startswith(parent + '/' if parent else '')]:
                            base_kind.pop(p)
                            base_meta.pop(p, None)
                    elif name.startswith('.wh.'):
                        target = posixpath.join(parent, name[4:])
                        for p in [p for p in base_kind if p == target or p.startswith(target + '/')]:
                            base_kind.pop(p)
                            base_meta.pop(p, None)
                    else:
                        # Preserve implicit ancestor directories in the effective base tree.
                        # These must be removed by later base whiteouts along with descendants.
                        for anc in _ancestors(path):
                            base_kind.setdefault(anc, 'dir')
                        base_kind[path] = kind
                        base_meta[path] = metadata
            symlinks = {p for p, k in base_kind.items() if k == 'symlink'}
            for i in range(n, len(diff_ids)):
                for path, kind, metadata in entries_in_layer(tar, layers[i], diff_ids[i]):
                    for anc in _ancestors(path):
                        if anc in symlinks:
                            violate(f'{path}: written through symlink {anc}')
                    name = posixpath.basename(path)
                    parent = posixpath.dirname(path)
                    if name == '.wh..wh..opq':
                        prefix = parent + '/' if parent else ''
                        if any(p.startswith(prefix) for p in base_kind):
                            violate(f'{parent or "/"}: opaque whiteout hides base content')
                        continue
                    if name.startswith('.wh.'):
                        target = posixpath.join(parent, name[4:])
                        if overlaps_base(target):
                            violate(f'{target}: whiteout deletes base path or descendants')
                        continue
                    existing = base_kind.get(path)
                    if existing is not None:
                        # Directory re-declaration is only additive when mode, owner and
                        # metadata are identical to an EXPLICIT directory in the base.
                        if not (existing == 'dir' and kind == 'dir' and
                                base_meta.get(path) == metadata):
                            violate(f'{path}: base {existing} replaced by {kind}')
                    # Later application layers may overwrite earlier APPLICATION files freely.
                    if kind == 'symlink':
                        symlinks.add(path)
    except (NotImplementedError, BudgetExceeded) as e:
        # Fail closed for exception inheritance only; the release itself is not blocked.
        violations.insert(0, f'cannot analyse layers: {e}')
    report['additive'] = not violations
    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument('archive')
    p.add_argument('--base-config', required=True)
    p.add_argument('--output', required=True)
    a = p.parse_args()
    try:
        report = analyse(a.archive, json.loads(pathlib.Path(a.base_config).read_text()))
    except (ValueError, OSError, tarfile.TarError, EOFError, json.JSONDecodeError) as e:
        raise SystemExit(f'LAYER ANALYSIS FAILED: {e}')
    pathlib.Path(a.output).write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    state = 'ADDITIVE' if report['additive'] else 'NOT ADDITIVE (base exceptions will not be inherited)'
    print(f"application layers {state}")
    for v in report['violations']:
        print('  ' + v, file=sys.stderr)


if __name__ == '__main__':
    main()
