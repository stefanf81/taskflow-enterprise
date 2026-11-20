#!/usr/bin/env python3
"""Hand the authorized application source to later jobs WITHOUT giving them a read token.

`authorize` is the only job that holds APPLICATION_READ_TOKEN. It checks out the exact
commit, writes `git archive` of it and passes the archive's SHA-256 (plus the commit
time) as job outputs. `compile` and `image_build` download the archive, check that hash
and extract it; they need no token and no environment secret.

  create  --repo DIR --commit SHA --output source.tar
          prints JSON {"sha256", "commit_epoch", "commit_iso"}
  extract --archive source.tar --sha256 HEX --dest DIR
          refuses a wrong hash, a non-empty destination, and (via the tarfile 'data'
          filter) absolute paths, '..', device files and links that leave DIR.

The archive has no .git directory. Builds that need commit metadata must read APP_COMMIT,
SOURCE_DATE_EPOCH or BUILD_OUTPUT_TIMESTAMP from the environment.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tarfile

COMMIT = re.compile(r'[a-f0-9]{40}')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def create(repo, commit, output):
    if not COMMIT.fullmatch(commit):
        raise ValueError('commit must be a full 40-character SHA-1')
    head = subprocess.run(['git', '-C', repo, 'rev-parse', 'HEAD'], check=True, capture_output=True,
                          text=True).stdout.strip()
    if head != commit:
        raise ValueError(f'checked-out HEAD {head} is not the authorized commit')
    with open(output, 'wb') as f:
        subprocess.run(['git', '-C', repo, 'archive', '--format=tar', commit], check=True, stdout=f)
    show = subprocess.run(['git', '-C', repo, 'show', '-s', '--format=%ct %cI', commit], check=True,
                          capture_output=True, text=True).stdout.split()
    return {'sha256': sha256(output), 'commit_epoch': show[0], 'commit_iso': show[1]}


def extract(archive, expected_sha256, dest):
    if not re.fullmatch(r'[a-f0-9]{64}', expected_sha256 or ''):
        raise ValueError('expected SHA-256 must be 64 lowercase hex digits')
    if sha256(archive) != expected_sha256:
        raise ValueError('source archive does not match the hash recorded by the authorize job')
    dest = pathlib.Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    if any(dest.iterdir()):
        raise ValueError(f'{dest} must be empty')
    with tarfile.open(archive, 'r:') as tar:
        tar.extractall(dest, filter='data')


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('create')
    c.add_argument('--repo', required=True)
    c.add_argument('--commit', required=True)
    c.add_argument('--output', required=True)
    e = sub.add_parser('extract')
    e.add_argument('--archive', required=True)
    e.add_argument('--sha256', required=True)
    e.add_argument('--dest', required=True)
    a = p.parse_args()
    try:
        if a.cmd == 'create':
            print(json.dumps(create(a.repo, a.commit, a.output), sort_keys=True))
        else:
            extract(a.archive, a.sha256, a.dest)
            print(f'extracted verified source archive into {a.dest}')
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError) as err:
        raise SystemExit(f'SOURCE ARCHIVE REJECTED: {err}')


if __name__ == '__main__':
    main()
