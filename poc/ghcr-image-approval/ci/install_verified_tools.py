#!/usr/bin/env python3
"""Install the pinned security executables after verifying them against ci/toolchain.lock.json.

GitHub-hosted runners do not provide crane, cosign, Syft, Grype or diffoci, and their `gh`
changes with every runner image. Each tool is therefore downloaded from an exact versioned
GitHub release URL and installed only if BOTH its byte size and its SHA-256 equal the values
in the protected lock. No "latest", no shell pipelines, no archive unpacking to disk: one
named member is read from the archive in memory.

The lock records every asset's size, so `validate_lock` (and a unit test) can prove offline
that each pinned asset fits the download limit. v4 shipped a 120 MiB binary limit while the
pinned cosign binary is 139 MiB, so cosign could never be installed.

After a successful run the directory is prepended to PATH (GITHUB_PATH) and exported as
VERIFIED_TOOLS_DIR; ci/require_tools.sh then refuses any pinned tool that resolves elsewhere.

Updating a pin: change version, url, sha256 and size together in a reviewed pull request,
after checking the publisher's signed checksum file (see docs/SETUP.md, "Pinned tools").
"""
import argparse
import hashlib
import io
import json
import os
import pathlib
import re
import ssl
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

NEEDS = {
    'base': {'crane', 'cosign', 'syft', 'grype', 'diffoci', 'gh'},
    'promote': {'crane', 'cosign', 'gh'},
    'scan': {'crane', 'cosign', 'syft', 'grype', 'gh'},
    'rescan': {'crane', 'grype'},
    'image-build': {'crane', 'cosign'},
    'push': {'crane', 'gh'},
    'api': {'gh'},
    'verify': set(),
    'lint': {'actionlint'},
}
PINNED = ('crane', 'cosign', 'syft', 'grype', 'diffoci', 'gh', 'actionlint')
MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
MAX_BINARY_BYTES = 256 * 1024 * 1024
DOWNLOAD_ATTEMPTS = 3
SHA = re.compile(r'[a-f0-9]{64}')
URL = re.compile(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[^\s/]+/[^\s/]+')
VERSION = re.compile(r'v\d+\.\d+\.\d+')
FORMATS = ('raw', 'tar.gz', 'zip')


def _download(url, attempts=DOWNLOAD_ATTEMPTS, sleep=time.sleep):
    """Bounded download with a few retries for transient network errors (never for bad content)."""
    if not isinstance(url, str) or not URL.fullmatch(url):
        raise ValueError('toolchain asset must be an explicit versioned GitHub release URL')
    last = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'ghcr-security-toolchain/5'})
            with urllib.request.urlopen(req, timeout=120, context=ssl.create_default_context()) as response:
                data = response.read(MAX_DOWNLOAD_BYTES + 1)
            if len(data) > MAX_DOWNLOAD_BYTES:
                raise ValueError('toolchain asset exceeds the download size limit')
            return data
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = exc
            if attempt + 1 < attempts:
                sleep(2 * (attempt + 1))
    raise urllib.error.URLError(f'download failed after {attempts} attempts: {last}')


def _binary(data, item, name):
    kind = item['format']
    member = item.get('member', name)
    if kind == 'raw':
        result = data
    elif kind == 'tar.gz':
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            entries = [m for m in archive if m.name.removeprefix('./') == member]
            if len(entries) != 1 or not entries[0].isfile() or entries[0].size > MAX_BINARY_BYTES:
                raise ValueError(f'{name}: expected exactly one regular archive member {member!r}')
            result = archive.extractfile(entries[0]).read(MAX_BINARY_BYTES + 1)
    else:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            matched = [x for x in archive.infolist() if x.filename == member]
            if len(matched) != 1 or matched[0].file_size > MAX_BINARY_BYTES:
                raise ValueError(f'{name}: archive member {member!r} missing or oversized')
            result = archive.read(matched[0])
    if not result or len(result) > MAX_BINARY_BYTES:
        raise ValueError(f'{name}: binary is empty or larger than {MAX_BINARY_BYTES} bytes')
    return result


def validate_lock(lock, needs):
    """Fail closed on any incomplete, inconsistent or oversized entry BEFORE downloading anything."""
    if not isinstance(lock, dict) or lock.get('schema') != 2 or not isinstance(lock.get('tools'), dict):
        raise ValueError('invalid toolchain lock schema (expected schema 2)')
    if lock.get('platform') != 'linux/amd64':
        raise ValueError('toolchain lock is for linux/amd64 runners only')
    for name in sorted(needs):
        item = lock['tools'].get(name)
        if not isinstance(item, dict):
            raise ValueError(f'{name}: missing pinned tool entry')
        sha, version, url, size = item.get('sha256'), item.get('version'), item.get('url'), item.get('size')
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise ValueError(f'{name}: supply a genuine SHA-256 checksum')
        if not isinstance(version, str) or not VERSION.fullmatch(version):
            raise ValueError(f'{name}: supply an exact release version (vX.Y.Z)')
        if not isinstance(url, str) or not URL.fullmatch(url) or 'latest' in url.lower():
            raise ValueError(f'{name}: supply an exact, non-latest GitHub release asset URL')
        if f'/download/{version}/' not in url:
            raise ValueError(f'{name}: release URL must match the locked version')
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise ValueError(f'{name}: supply the exact asset size in bytes')
        if size > MAX_DOWNLOAD_BYTES:
            raise ValueError(f'{name}: pinned asset ({size} bytes) exceeds the download limit '
                             f'({MAX_DOWNLOAD_BYTES} bytes); raise the limit in the same reviewed change')
        if item.get('format') not in FORMATS:
            raise ValueError(f'{name}: format must be one of {FORMATS}')
        member = item.get('member', name)
        if (not isinstance(member, str) or not member or member.startswith('/')
                or '..' in pathlib.PurePosixPath(member).parts):
            raise ValueError(f'{name}: invalid archive member')
        if item['format'] == 'raw' and size > MAX_BINARY_BYTES:
            raise ValueError(f'{name}: pinned binary exceeds the binary size limit')
    return True


def install(lock, needs, destination, downloader=_download):
    validate_lock(lock, needs)
    dest = pathlib.Path(destination)
    dest.mkdir(parents=True, exist_ok=True)
    for name in sorted(needs):
        item = lock['tools'][name]
        data = downloader(item['url'])
        if len(data) != item['size']:
            raise ValueError(f'{name}: downloaded asset is {len(data)} bytes, lock says {item["size"]}')
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError(f'{name}: downloaded release asset SHA-256 differs from protected lock')
        binary = _binary(data, item, name)
        with tempfile.NamedTemporaryFile(dir=dest, prefix='.verified-', delete=False) as out:
            out.write(binary)
            tmp = pathlib.Path(out.name)
        os.chmod(tmp, 0o700)
        tmp.replace(dest / name)
    return dest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=sorted(NEEDS), required=True)
    parser.add_argument('--lock', default='ci/toolchain.lock.json')
    parser.add_argument('--list', action='store_true', help='print the pinned tools of --kind and exit')
    args = parser.parse_args()
    if args.list:
        print('\n'.join(sorted(NEEDS[args.kind])))
        return
    target = pathlib.Path(os.environ.get('RUNNER_TEMP', tempfile.gettempdir())) / 'verified-security-tools'
    try:
        lock = json.loads(pathlib.Path(args.lock).read_text())
        installed = install(lock, NEEDS[args.kind], target)
    except (OSError, ValueError, urllib.error.URLError, tarfile.TarError, zipfile.BadZipFile) as exc:
        raise SystemExit(f'REFUSING UNVERIFIED TOOLCHAIN: {exc}')
    for variable, line in (('GITHUB_PATH', str(installed)), ('GITHUB_ENV', f'VERIFIED_TOOLS_DIR={installed}')):
        if os.environ.get(variable):
            with open(os.environ[variable], 'a', encoding='utf-8') as output:
                print(line, file=output)
    print(f'Installed {len(NEEDS[args.kind])} verified tools to {installed}')


if __name__ == '__main__':
    main()
