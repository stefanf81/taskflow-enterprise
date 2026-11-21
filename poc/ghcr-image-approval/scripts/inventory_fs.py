#!/usr/bin/env python3
"""Hash ALL regular files of a flattened OCI filesystem export (never execute them).

Fail closed on untrusted/ambiguous TAR paths and links. Do not extract the TAR.
Input: crane export --platform PLATFORM IMAGE - | python3 -I scripts/inventory_fs.py OUTPUT
"""
import argparse
import hashlib
import json
import posixpath
import sys
import tarfile

MAX_FILESYSTEM_ENTRIES = 400_000
MAX_REGULAR_FILE_BYTES = 4 * 1024 ** 3
MAX_TOTAL_FILE_BYTES = 12 * 1024 ** 3
MAX_PATH_LENGTH = 4096

SENSITIVE_PREFIXES = (
    'etc/ld.so.preload', 'etc/ld.so.conf', 'etc/profile', 'etc/environment',
    'etc/bash.bashrc', 'etc/cron', 'etc/systemd/', 'etc/init.d/', 'root/',
    'etc/passwd', 'etc/shadow', 'etc/group', 'etc/gshadow', 'etc/sudoers',
    'etc/pam.d/', 'etc/security/', 'etc/nsswitch.conf', 'etc/ssh/',
    'etc/apt/sources.list', 'etc/apt/trusted.gpg', 'etc/apt/keyrings/',
    'usr/share/keyrings/', 'etc/ssl/', 'etc/ca-certificates',
    'usr/local/share/ca-certificates/', 'opt/java/openjdk/conf/security/',
    'opt/java/openjdk/lib/security/', 'etc/hosts', 'etc/resolv.conf',
)


def normalize(name):
    if not isinstance(name, str) or '\\' in name or '\x00' in name:
        raise ValueError(f'Unsafe TAR path {name!r}')
    if len(name.encode('utf-8')) > MAX_PATH_LENGTH:
        raise ValueError('TAR member path exceeds allowed length')
    path = name.lstrip('/')
    while path.startswith('./'):
        path = path[2:]
    if '..' in path.split('/'):
        raise ValueError(f'Path traversal in TAR: {name!r}')
    result = posixpath.normpath(path)
    if result in ('', '.', '..') or result.startswith('../'):
        raise ValueError(f'Invalid TAR path {name!r}')
    return result


def is_sensitive(path):
    return any(path == p.rstrip('/') or path.startswith(p) for p in SENSITIVE_PREFIXES)


def is_code(path, mode, head):
    name = posixpath.basename(path)
    suffixes = ('.so', '.jar', '.jmod', '.class', '.py', '.pyc', '.js', '.mjs',
                '.cjs', '.sh', '.bash', '.lua', '.php', '.pl', '.rb', '.wasm', '.exe', '.dll')
    return bool(mode & 0o6111 or head.startswith((b'\x7fELF', b'#!')) or
                name.endswith(suffixes) or '.so.' in name)


def inventory(stream):
    files, symlinks, symlink_metadata, directories, pending_hardlinks, special = {}, {}, {}, {}, {}, {}
    seen = set()
    total_file_bytes = 0
    with tarfile.open(fileobj=stream, mode='r|*') as tf:
        for member in tf:
            # `crane export` and other flattened TAR streams may include the root
            # directory entry; its metadata isn't portable across export tools.
            if member.isdir() and member.name in ('.', './', '/', ''):
                continue
            path = normalize(member.name)
            if path in seen:
                raise ValueError(f'Duplicate TAR member {path!r}: cannot trust flattened export')
            seen.add(path)
            if len(seen) > MAX_FILESYSTEM_ENTRIES:
                raise ValueError('filesystem TAR contains excessive entries')
            mode = member.mode & 0o7777
            # Flattened TAR exports may omit xattrs. Capture them where supplied, but
            # this inventory cannot prove absent metadata on a format that drops it.
            security_attrs = {k: hashlib.sha256(str(v).encode('utf-8')).hexdigest()
                              for k, v in sorted(member.pax_headers.items())
                              if k.startswith(('SCHILY.xattr.', 'LIBARCHIVE.xattr.',
                                               'SCHILY.acl.', 'SCHILY.fflags'))}
            common = {'mode': oct(mode), 'uid': member.uid, 'gid': member.gid,
                      'security_attrs': security_attrs}
            if member.isdir():
                directories[path] = common
                continue
            if member.issym():
                target = member.linkname
                if not target or '\x00' in target or '\\' in target:
                    raise ValueError(f'Invalid symlink target {path!r}')
                # A symlink into or outside root is risky; preserve its text and let policy review.
                symlinks[path] = target
                symlink_metadata[path] = common
                continue
            if member.islnk():
                pending_hardlinks[path] = (normalize(member.linkname), mode, member.uid, member.gid, security_attrs)
                continue
            if member.ischr() or member.isblk() or member.isfifo():
                # Recorded for the policy (REVIEW on any change) instead of aborting the run.
                kind = 'char' if member.ischr() else ('block' if member.isblk() else 'fifo')
                special[path] = {'type': kind, 'mode': oct(mode),
                                 'device': f'{member.devmajor}:{member.devminor}' if kind != 'fifo' else '',
                                 'uid': member.uid, 'gid': member.gid, 'security_attrs': security_attrs}
                continue
            if not member.isfile():
                raise ValueError(f'Unsupported TAR entry type for {path!r}: {member.type!r}')
            if member.size > MAX_REGULAR_FILE_BYTES or total_file_bytes + member.size > MAX_TOTAL_FILE_BYTES:
                raise ValueError('filesystem TAR exceeds decompressed byte budget')
            total_file_bytes += member.size
            f = tf.extractfile(member)
            if f is None:
                raise ValueError(f'Cannot read TAR member {path!r}')
            head = f.read(512)
            digest = hashlib.sha256(head)
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                digest.update(chunk)
            files[path] = {
                'mode': oct(mode), 'size': member.size, 'sha256': digest.hexdigest(),
                'uid': member.uid, 'gid': member.gid, 'security_attrs': security_attrs, 'entry_kind': 'regular',
                'suid_or_sgid': bool(mode & 0o6000), 'exec_bits': bool(mode & 0o111),
                'is_code': is_code(path, mode, head),
            }
    # Resolve forward hardlinks as well as ordinary hardlinks. Detect cycles / missing targets.
    resolving = set()

    def resolve(path):
        if path in files:
            return files[path]
        if path not in pending_hardlinks or path in resolving:
            raise ValueError(f'Unresolved/cyclic TAR hardlink {path!r}')
        resolving.add(path)
        target, mode, uid, gid, attrs = pending_hardlinks[path]
        base = resolve(target)
        item = dict(base)
        item.update(mode=oct(mode), suid_or_sgid=bool(mode & 0o6000),
                    exec_bits=bool(mode & 0o111), hardlink_to=target, uid=uid, gid=gid,
                    entry_kind='hardlink', security_attrs=attrs)
        item['is_code'] = item['is_code'] or bool(mode & 0o6111)
        files[path] = item
        resolving.remove(path)
        return item

    for path in pending_hardlinks:
        resolve(path)
    sensitive = {p: value for p, value in files.items() if is_sensitive(p)}
    sensitive.update({p: {'symlink_to': target} for p, target in symlinks.items() if is_sensitive(p)})
    return {'files': files, 'sensitive_files': sensitive, 'symlinks': symlinks,
            'symlink_metadata': symlink_metadata, 'directories': directories,
            'special_files': special, 'inventory_version': 7, 'regular_file_count': len(files)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output')
    args = parser.parse_args()
    result = inventory(sys.stdin.buffer)
    with open(args.output, 'w', encoding='utf-8') as out:
        json.dump(result, out, indent=2, sort_keys=True)


if __name__ == '__main__':
    main()
