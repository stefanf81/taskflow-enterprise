#!/usr/bin/env python3
"""Move only SHA-256-verified application build files across isolated Actions jobs."""
import argparse
import io
import json
import pathlib
import shutil
import stat
import tarfile
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from artifact_manifest import manifest  # noqa: E402

MAX_BYTES = 2 * 1024 ** 3


def pack(root, manifest_path, tar_path):
    info = json.loads(pathlib.Path(manifest_path).read_text())
    expected = manifest(root, ' '.join(x['path'] for x in info['files']))
    if info != expected:
        raise ValueError('build artifact manifest differs from actual files')
    total = 0
    with tarfile.open(tar_path, 'w', format=tarfile.PAX_FORMAT) as out:
        for entry in expected['files']:
            file = pathlib.Path(root) / entry['path']
            total += entry['size']
            if total > MAX_BYTES: raise ValueError('build outputs over 2 GiB limit')
            # Normalized metadata so the tar is suitable for stable artifact attestation.
            ti = tarfile.TarInfo(entry['path'])
            ti.mode = 0o644
            ti.uid = ti.gid = ti.mtime = 0
            ti.uname = ti.gname = ''
            ti.size = entry['size']
            with file.open('rb') as fh: out.addfile(ti, fh)


def unpack(root, manifest_path, tar_path):
    info = json.loads(pathlib.Path(manifest_path).read_text())
    files = info.get('files')
    if not isinstance(files, list) or not files:
        raise ValueError('missing declared output files')
    expected = {x['path'] for x in files}
    total = 0
    with tarfile.open(tar_path, 'r:') as archive:
        members = archive.getmembers()
        if set(m.name for m in members) != expected or len(members) != len(expected):
            raise ValueError('tar contains undeclared, missing or duplicate outputs')
        for member in members:
            if not member.isfile() or member.size < 0:
                raise ValueError('tar contains non-regular member')
            total += member.size
            if total > MAX_BYTES: raise ValueError('tar too large')
            part = pathlib.PurePosixPath(member.name)
            if part.is_absolute() or any(x in ('', '.', '..') for x in part.parts):
                raise ValueError('unsafe output member path')
            current = pathlib.Path(root)
            for name in part.parts[:-1]:
                current = current / name
                if current.is_symlink():
                    raise ValueError('output directory symlink not permitted')
                if not current.exists(): current.mkdir()
                if not current.is_dir(): raise ValueError('output parent is not a directory')
            destination = current / part.parts[-1]
            if destination.is_symlink():
                raise ValueError('output target symlink not permitted')
            # No extraction of symlinks, metadata, ownership, or arbitrary paths.
            with archive.extractfile(member) as src, destination.open('xb') as dst:
                shutil.copyfileobj(src, dst)
    actual = manifest(root, ' '.join(sorted(expected)))
    if info != actual:
        raise ValueError('tar content differs from expected SHA-256 manifest')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('operation', choices=('pack', 'unpack'))
    p.add_argument('--root', required=True)
    p.add_argument('--manifest', required=True)
    p.add_argument('--tar', required=True)
    args = p.parse_args()
    try:
        (pack if args.operation == 'pack' else unpack)(args.root, args.manifest, args.tar)
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        raise SystemExit('OUTPUT TRANSPORT REJECTED: ' + str(error))


if __name__ == '__main__': main()
